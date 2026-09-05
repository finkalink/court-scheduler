"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildPaymentConfirmationEmail, sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/appUrl";

const EXCLUSION_VIOLATION = "23P01";

async function resolveVenmoHandle(supabase: SupabaseClient, locationId: string): Promise<string | null> {
  const { data } = await supabase
    .from("locations")
    .select("organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();
  const org = data ? (Array.isArray(data.organization) ? data.organization[0] : data.organization) : null;
  return org?.venmo_handle ?? null;
}

function eventFieldsFromFormData(formData: FormData) {
  const registrationMode = String(formData.get("registration_mode") || "individual");
  const teamFormationInput = String(formData.get("team_formation") || "");
  const capacity = String(formData.get("capacity") || "");
  const feeDollars = String(formData.get("fee_dollars") || "").trim();

  return {
    event_type: String(formData.get("event_type") || "tournament"),
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || "") || null,
    registration_mode: registrationMode,
    team_formation: registrationMode === "team" ? teamFormationInput || "self_formed" : null,
    capacity: capacity ? Number(capacity) : null,
    fee_cents: feeDollars && Number(feeDollars) > 0 ? Math.round(Number(feeDollars) * 100) : null,
    status: String(formData.get("status") || "draft"),
  };
}

export async function createEvent(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const fields = eventFieldsFromFormData(formData);

  const supabase = await createClient();

  if (fields.fee_cents) {
    const venmoHandle = await resolveVenmoHandle(supabase, locationId);
    if (!venmoHandle) {
      redirect(
        `/admin/locations/${locationId}/events?event_error=${encodeURIComponent("Set your club's Venmo handle on the club dashboard before charging a fee.")}`
      );
    }
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({ location_id: locationId, ...fields })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events`);
  redirect(`/admin/locations/${locationId}/events/${event.id}?event_added=1`);
}

export async function updateEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const fields = eventFieldsFromFormData(formData);

  const supabase = await createClient();

  if (fields.fee_cents) {
    const venmoHandle = await resolveVenmoHandle(supabase, locationId);
    if (!venmoHandle) {
      redirect(
        `/admin/locations/${locationId}/events/${eventId}?event_error=${encodeURIComponent("Set your club's Venmo handle on the club dashboard before charging a fee.")}`
      );
    }
  }

  const { error } = await supabase
    .from("events")
    .update(fields)
    .eq("id", eventId)
    .eq("location_id", locationId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?event_saved=1`);
}

// start_time/end_time arrive as datetime-local strings (no timezone info,
// e.g. "2026-09-12T09:00") from Task 4's form -- fromZonedTime converts
// that wall-clock string to a real UTC instant using the location's own
// timezone, the write-side counterpart to formatInTimeZone already used
// for display elsewhere in this codebase.
export async function addEventSession(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const courtId = String(formData.get("court_id"));
  const label = String(formData.get("label") || "") || null;

  const supabase = await createClient();

  // Resolve the event's own location (and its timezone) from the event_id
  // itself, rather than trusting the submitted location_id form field --
  // keeps this action correct even if it's ever reached from a page that
  // doesn't already guarantee the two match.
  const { data: event } = await supabase
    .from("events")
    .select("location_id, location:locations(timezone)")
    .eq("id", eventId)
    .single();

  if (!event) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?session_error=${encodeURIComponent("Event not found.")}`
    );
  }

  const eventLocation = Array.isArray(event.location) ? event.location[0] : event.location;
  const timezone = eventLocation?.timezone ?? "UTC";

  // A court from a different location should never be assignable to this
  // event's sessions -- reject it up front instead of silently accepting it.
  const { data: court } = await supabase
    .from("courts")
    .select("id")
    .eq("id", courtId)
    .eq("location_id", event.location_id)
    .single();

  if (!court) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?session_error=${encodeURIComponent("That court doesn't belong to this event's location.")}`
    );
  }

  const startTime = fromZonedTime(String(formData.get("start_time")), timezone).toISOString();
  const endTime = fromZonedTime(String(formData.get("end_time")), timezone).toISOString();

  const { data: session, error: sessionError } = await supabase
    .from("event_sessions")
    .insert({ event_id: eventId, court_id: courtId, start_time: startTime, end_time: endTime, label })
    .select("id")
    .single();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const { error: bookingError } = await supabase.from("bookings").insert({
    court_id: courtId,
    source: "event",
    event_session_id: session.id,
    start_time: startTime,
    end_time: endTime,
  });

  if (bookingError) {
    // Roll back the orphaned session row -- the booking is what actually
    // reserves the court, so a session without one is meaningless.
    await supabase.from("event_sessions").delete().eq("id", session.id);
    const message =
      bookingError.code === EXCLUSION_VIOLATION
        ? "That court is already booked or blocked at that time."
        : bookingError.message;
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?session_error=${encodeURIComponent(message)}`
    );
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/events`);
  revalidatePath(`/events/${eventId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_added=1`);
}

export async function removeEventSession(formData: FormData) {
  const sessionId = String(formData.get("session_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  // Need the session's court before it's gone, so the court booking pages
  // (player-facing and admin) can be revalidated too -- deleting the
  // session cascades to its paired bookings row (bookings.event_session_id
  // references event_sessions on delete cascade), freeing the court time
  // in one step.
  const { data: session } = await supabase
    .from("event_sessions")
    .select("court_id")
    .eq("id", sessionId)
    .single();

  const { error } = await supabase.from("event_sessions").delete().eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  if (session?.court_id) {
    revalidatePath(`/locations/${locationId}/courts/${session.court_id}`);
    revalidatePath(`/admin/locations/${locationId}/courts/${session.court_id}`);
  }
  revalidatePath(`/events`);
  revalidatePath(`/events/${eventId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_removed=1`);
}

export async function markRegistrationPaid(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("event_registrations")
    .update({ payment_status: "paid" })
    .eq("id", registrationId)
    .eq("payment_status", "pending")
    .select("id, display_name, team:event_teams(name), event:events(id, title, fee_cents)");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?payment_error=${encodeURIComponent("Couldn't mark that registration paid.")}`
    );
  }

  const registration = updated[0];
  const event = Array.isArray(registration.event) ? registration.event[0] : registration.event;
  const team = Array.isArray(registration.team) ? registration.team[0] : registration.team;

  if (event?.fee_cents) {
    const { data: notify } = await supabase.rpc("get_registration_notification_email", {
      p_registration_id: registrationId,
    });
    const email = notify?.[0]?.email;
    if (email) {
      await sendEmail(
        email,
        buildPaymentConfirmationEmail({
          eventTitle: event.title,
          amountCents: event.fee_cents,
          registrantLabel: team?.name ?? registration.display_name ?? "Registration",
          eventUrl: `${getAppUrl()}/events/${event.id}`,
        })
      );
    }
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/registrations`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?payment_marked=1`);
}

export async function markRegistrationRefunded(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("event_registrations")
    .update({ payment_status: "refunded" })
    .eq("id", registrationId)
    .eq("payment_status", "paid")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?payment_error=${encodeURIComponent("Couldn't mark that registration refunded.")}`
    );
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/registrations`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?payment_marked=1`);
}
