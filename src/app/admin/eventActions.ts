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

  const { data: location } = await supabase
    .from("locations")
    .select("timezone")
    .eq("id", locationId)
    .single();
  const timezone = location?.timezone ?? "UTC";

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
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_added=1`);
}

export async function removeEventSession(formData: FormData) {
  const sessionId = String(formData.get("session_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  // Deleting the session cascades to its paired bookings row
  // (bookings.event_session_id references event_sessions on delete cascade),
  // freeing the court time in one step.
  const { error } = await supabase.from("event_sessions").delete().eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_removed=1`);
}
