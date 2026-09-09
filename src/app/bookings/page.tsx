import Link from "next/link";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatRequestedConfig } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";
import { cancelBooking } from "@/app/actions/bookings";
import { categorizeBookingTime, groupBookingsByTime, isCancellable } from "@/lib/bookingStatus";
import SuccessBanner from "@/components/SuccessBanner";

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; tab?: string; error?: string }>;
}) {
  const { cancelled, tab, error } = await searchParams;
  const activeTab = tab === "past" ? "past" : "upcoming";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/bookings");
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, start_time, end_time, status, price, requested_net_height, requested_court_lines, court:courts(id, name, location:locations(id, name, timezone, organization:organizations(name)))"
    )
    .eq("user_id", user.id)
    .order("start_time", { ascending: false });

  const now = new Date();
  const { upcoming, inProgress, past } = groupBookingsByTime(bookings ?? [], now);
  const visibleBookings = activeTab === "past" ? past : [...inProgress, ...upcoming];

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">My Bookings</h1>

      {cancelled && <SuccessBanner>Booking cancelled.</SuccessBanner>}
      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-4 border-b border-border">
        <Link
          href="/bookings?tab=upcoming"
          className={
            activeTab === "upcoming"
              ? "border-b-2 border-accent px-1 pb-2 text-sm font-medium"
              : "px-1 pb-2 text-sm text-fg-muted"
          }
        >
          Upcoming
        </Link>
        <Link
          href="/bookings?tab=past"
          className={
            activeTab === "past"
              ? "border-b-2 border-accent px-1 pb-2 text-sm font-medium"
              : "px-1 pb-2 text-sm text-fg-muted"
          }
        >
          Past
        </Link>
      </div>

      {visibleBookings.length === 0 && (
        <p className="mt-6 text-sm text-fg-muted">
          {activeTab === "past" ? "No past bookings." : "You don't have any upcoming bookings."}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {visibleBookings.map((booking) => {
          const court = Array.isArray(booking.court) ? booking.court[0] : booking.court;
          const location = Array.isArray(court?.location) ? court?.location[0] : court?.location;
          const organization = Array.isArray(location?.organization)
            ? location?.organization[0]
            : location?.organization;
          const timezone = location?.timezone ?? "UTC";
          const dateLabel = formatBookingDate(booking.start_time, timezone);
          const timeLabel = `${formatInTimeZone(new Date(booking.start_time), timezone, "h:mm a")} – ${formatInTimeZone(new Date(booking.end_time), timezone, "h:mm a")}`;
          const timeStatus = categorizeBookingTime(booking.start_time, booking.end_time, now);

          return (
            <li
              key={booking.id}
              className="flex items-center justify-between rounded border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {dateLabel} · {timeLabel}
                </p>
                <p className="text-sm text-fg-muted">
                  {court?.name}
                  {organization?.name ? ` · ${organization.name}` : ""}
                </p>
                {formatRequestedConfig(booking.requested_net_height, booking.requested_court_lines) && (
                  <p className="text-sm text-fg-muted">
                    {formatRequestedConfig(booking.requested_net_height, booking.requested_court_lines)}
                  </p>
                )}
                <Link href={`/bookings/${booking.id}`} className="text-sm underline">
                  View details
                </Link>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={
                    booking.status === "confirmed"
                      ? "rounded bg-success-bg px-2 py-1 text-xs text-success-fg"
                      : "rounded bg-active px-2 py-1 text-xs text-fg-muted"
                  }
                >
                  {booking.status}
                </span>
                {timeStatus === "in_progress" && booking.status === "confirmed" && (
                  <span className="text-xs text-fg-muted">In progress</span>
                )}
                {isCancellable(booking.status, timeStatus) && (
                  <form action={cancelBooking}>
                    <input type="hidden" name="booking_id" value={booking.id} />
                    <input type="hidden" name="location_id" value={location?.id ?? ""} />
                    <input type="hidden" name="court_id" value={court?.id ?? ""} />
                    <input type="hidden" name="redirect_to" value="/bookings" />
                    <button type="submit" className="text-xs text-error-fg underline">
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
