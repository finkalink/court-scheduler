"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatRequestedConfig } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";
import { buildBookingCancellationEmail, buildBookingConfirmationEmail, sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/appUrl";

const EXCLUSION_VIOLATION = "23P01";

type BookingCourtInfo = {
  name: string;
  location: {
    name: string;
    timezone: string;
    organization: { name: string } | { name: string }[] | null;
  } | { name: string; timezone: string; organization: { name: string } | { name: string }[] | null }[] | null;
};

function bookingEmailDetails(
  bookingId: string,
  startTime: string,
  endTime: string,
  court: BookingCourtInfo | BookingCourtInfo[] | null,
  requestedNetHeight: string | null,
  requestedCourtLines: string | null
) {
  const courtInfo = Array.isArray(court) ? court[0] : court;
  const location = Array.isArray(courtInfo?.location) ? courtInfo?.location[0] : courtInfo?.location;
  const organization = Array.isArray(location?.organization)
    ? location?.organization[0]
    : location?.organization;
  const timezone = location?.timezone ?? "UTC";

  return {
    bookingId,
    dateLabel: formatBookingDate(startTime, timezone),
    timeLabel: `${formatInTimeZone(new Date(startTime), timezone, "h:mm a")} – ${formatInTimeZone(new Date(endTime), timezone, "h:mm a")}`,
    courtName: courtInfo?.name ?? "the court",
    organizationName: organization?.name ?? null,
    requestedConfig: formatRequestedConfig(requestedNetHeight, requestedCourtLines),
    appUrl: getAppUrl(),
    startTime,
    endTime,
  };
}

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
    .select("id, court:courts(name, location:locations(name, timezone, organization:organizations(name)))")
    .single();

  if (error) {
    const message =
      error.code === EXCLUSION_VIOLATION
        ? "That slot was just taken. Pick another one."
        : error.message;
    redirect(`${courtPath}?date=${date}&error=${encodeURIComponent(message)}`);
  }

  if (user.email) {
    const details = bookingEmailDetails(
      booking.id,
      startTime,
      endTime,
      booking.court,
      requestedNetHeight,
      requestedCourtLines
    );
    await sendEmail(user.email, buildBookingConfirmationEmail(details));
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
    .select(
      "source, start_time, end_time, requested_net_height, requested_court_lines, court:courts(name, location:locations(name, timezone, organization:organizations(name)))"
    )
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

  if (existing) {
    const { data: notify } = await supabase.rpc("get_booking_notification_email", {
      target_booking_id: bookingId,
    });
    const ownerEmail = notify?.[0]?.email;
    if (ownerEmail) {
      const details = bookingEmailDetails(
        bookingId,
        existing.start_time,
        existing.end_time,
        existing.court,
        existing.requested_net_height,
        existing.requested_court_lines
      );
      await sendEmail(ownerEmail, buildBookingCancellationEmail(details));
    }
  }

  revalidatePath("/bookings");
  if (locationId && courtId) {
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  }

  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}cancelled=1`);
}
