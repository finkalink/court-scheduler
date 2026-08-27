import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatRequestedConfig } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";
import { cancelBooking } from "@/app/actions/bookings";
import SuccessBanner from "@/components/SuccessBanner";

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { cancelled } = await searchParams;
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

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">My bookings</h1>

      {cancelled && <SuccessBanner>Booking cancelled.</SuccessBanner>}

      {(!bookings || bookings.length === 0) && (
        <p className="mt-6 text-sm text-gray-600">You haven&apos;t booked any slots yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {(bookings ?? []).map((booking) => {
          const court = Array.isArray(booking.court) ? booking.court[0] : booking.court;
          const location = Array.isArray(court?.location) ? court?.location[0] : court?.location;
          const organization = Array.isArray(location?.organization)
            ? location?.organization[0]
            : location?.organization;
          const timezone = location?.timezone ?? "UTC";
          const dateLabel = formatBookingDate(booking.start_time, timezone);
          const timeLabel = `${formatInTimeZone(new Date(booking.start_time), timezone, "h:mm a")} – ${formatInTimeZone(new Date(booking.end_time), timezone, "h:mm a")}`;

          return (
            <li
              key={booking.id}
              className="flex items-center justify-between rounded border border-gray-300 px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {dateLabel} · {timeLabel}
                </p>
                <p className="text-sm text-gray-600">
                  {court?.name}
                  {organization?.name ? ` · ${organization.name}` : ""}
                </p>
                {formatRequestedConfig(booking.requested_net_height, booking.requested_court_lines) && (
                  <p className="text-sm text-gray-600">
                    {formatRequestedConfig(booking.requested_net_height, booking.requested_court_lines)}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={
                    booking.status === "confirmed"
                      ? "rounded bg-green-50 px-2 py-1 text-xs text-green-800"
                      : "rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                  }
                >
                  {booking.status}
                </span>
                {booking.status === "confirmed" && (
                  <form action={cancelBooking}>
                    <input type="hidden" name="booking_id" value={booking.id} />
                    <input type="hidden" name="location_id" value={location?.id ?? ""} />
                    <input type="hidden" name="court_id" value={court?.id ?? ""} />
                    <input type="hidden" name="redirect_to" value="/bookings" />
                    <button type="submit" className="text-xs text-red-700 underline">
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
