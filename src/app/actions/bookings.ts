"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

export async function createBooking(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));
  const date = String(formData.get("date"));
  const requestedNetHeight = String(formData.get("requested_net_height") || "") || null;
  const requestedCourtLines = String(formData.get("requested_court_lines") || "") || null;

  const courtPath = `/locations/${locationId}/courts/${courtId}`;
  const bookPath = `${courtPath}/book?start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}&date=${date}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(bookPath)}`);
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      court_id: courtId,
      user_id: user.id,
      start_time: startTime,
      end_time: endTime,
      requested_net_height: requestedNetHeight,
      requested_court_lines: requestedCourtLines,
    })
    .select("id")
    .single();

  if (error) {
    const message =
      error.code === EXCLUSION_VIOLATION
        ? "That slot was just taken. Pick another one."
        : error.message;
    redirect(`${courtPath}?date=${date}&error=${encodeURIComponent(message)}`);
  }

  redirect(`/bookings/${booking.id}?booked=1`);
}

// Shared by both the player's own "My bookings" page and the admin court
// page — RLS ("bookings update own or member") is what actually decides
// whether this caller is allowed to cancel this particular booking.
export async function cancelBooking(formData: FormData) {
  const bookingId = String(formData.get("booking_id"));
  const locationId = String(formData.get("location_id") || "");
  const courtId = String(formData.get("court_id") || "");
  const redirectTo = String(formData.get("redirect_to") || "/bookings");

  const supabase = await createClient();

  // Event-held court time is a bookings row too (source = 'event'), but it
  // isn't a player reservation -- cancelling it here would just silently
  // free up court time an event is using. Reject it explicitly rather than
  // let the update below no-op without explanation.
  const { data: existing } = await supabase
    .from("bookings")
    .select("source")
    .eq("id", bookingId)
    .single();

  if (existing?.source === "event") {
    redirect(
      `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("This time is held by an event and can't be cancelled here.")}`
    );
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("source", "player");

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/bookings");
  if (locationId && courtId) {
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  }

  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}cancelled=1`);
}
