import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatRequestedConfig } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";
import { cancelBooking } from "@/app/actions/bookings";
import { categorizeBookingTime, isCancellable } from "@/lib/bookingStatus";
import SuccessBanner from "@/components/SuccessBanner";

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ booked?: string; cancelled?: string }>;
}) {
  const { bookingId } = await params;
  const { booked, cancelled } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/bookings/${bookingId}`)}`);
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, start_time, end_time, status, requested_net_height, requested_court_lines, court:courts(id, name, location:locations(id, name, timezone, organization:organizations(name)))"
    )
    .eq("id", bookingId)
    .single();

  if (!booking) {
    notFound();
  }

  const court = Array.isArray(booking.court) ? booking.court[0] : booking.court;
  const location = Array.isArray(court?.location) ? court?.location[0] : court?.location;
  const organization = Array.isArray(location?.organization)
    ? location?.organization[0]
    : location?.organization;
  const timezone = location?.timezone ?? "UTC";
  const dateLabel = formatBookingDate(booking.start_time, timezone);
  const timeLabel = `${formatInTimeZone(new Date(booking.start_time), timezone, "h:mm a")} – ${formatInTimeZone(new Date(booking.end_time), timezone, "h:mm a")}`;
  const now = new Date();
  const timeStatus = categorizeBookingTime(booking.start_time, booking.end_time, now);
  const requestedConfig = formatRequestedConfig(
    booking.requested_net_height,
    booking.requested_court_lines
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/bookings" className="text-sm underline">
        &larr; My Bookings
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">Booking Details</h1>

      {booked && <SuccessBanner>Booking confirmed.</SuccessBanner>}
      {cancelled && <SuccessBanner>Booking cancelled.</SuccessBanner>}

      <div className="mt-6 rounded border border-gray-300 px-4 py-3 dark:border-neutral-800">
        <p className="font-medium">
          {dateLabel} · {timeLabel}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">
          {court?.name}
          {organization?.name ? ` · ${organization.name}` : ""}
        </p>
        {requestedConfig && (
          <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">{requestedConfig}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span
            className={
              booking.status === "confirmed"
                ? "rounded bg-green-50 px-2 py-1 text-xs text-green-800 dark:bg-green-950 dark:text-green-300"
                : "rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
            }
          >
            {booking.status}
          </span>
          {timeStatus === "in_progress" && booking.status === "confirmed" && (
            <span className="text-xs text-gray-500">In progress</span>
          )}
        </div>

        {isCancellable(booking.status, timeStatus) && (
          <form action={cancelBooking} className="mt-4">
            <input type="hidden" name="booking_id" value={booking.id} />
            <input type="hidden" name="location_id" value={location?.id ?? ""} />
            <input type="hidden" name="court_id" value={court?.id ?? ""} />
            <input type="hidden" name="redirect_to" value={`/bookings/${booking.id}`} />
            <button type="submit" className="text-sm text-red-700 underline">
              Cancel booking
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
