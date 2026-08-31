"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

function eventFieldsFromFormData(formData: FormData) {
  const registrationMode = String(formData.get("registration_mode") || "individual");
  const teamFormationInput = String(formData.get("team_formation") || "");
  const capacity = String(formData.get("capacity") || "");

  return {
    event_type: String(formData.get("event_type") || "tournament"),
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || "") || null,
    registration_mode: registrationMode,
    team_formation: registrationMode === "team" ? teamFormationInput || "self_formed" : null,
    capacity: capacity ? Number(capacity) : null,
    status: String(formData.get("status") || "draft"),
  };
}

export async function createEvent(formData: FormData) {
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .insert({ location_id: locationId, ...eventFieldsFromFormData(formData) })
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update(eventFieldsFromFormData(formData))
    .eq("id", eventId);

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
