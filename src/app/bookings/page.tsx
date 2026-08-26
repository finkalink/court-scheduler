import Link from "next/link";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatRequestedConfig } from "@/lib/courtConfig";

export default async function MyBookingsPage() {
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
      "id, start_time, end_time, status, price, requested_net_height, requested_court_lines, court:courts(name, location:locations(name, timezone, organization:organizations(name)))"
    )
    .eq("user_id", user.id)
    .order("start_time", { ascending: false });

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">My bookings</h1>
        <Link href="/" className="text-sm underline">
          Book a slot
        </Link>
      </div>

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
          const dateLabel = formatInTimeZone(new Date(booking.start_time), timezone, "EEE, MMM d");
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
              <span
                className={
                  booking.status === "confirmed"
                    ? "rounded bg-green-50 px-2 py-1 text-xs text-green-800"
                    : "rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                }
              >
                {booking.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
