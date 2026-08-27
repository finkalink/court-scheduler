import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { saveAvailability, updateBookingConfig } from "@/app/admin/actions";
import { cancelBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";
import SuccessBanner from "@/components/SuccessBanner";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AdminCourtAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; courtId: string }>;
  searchParams: Promise<{ saved?: string; config_saved?: string; cancelled?: string }>;
}) {
  const { locationId, courtId } = await params;
  const { saved, config_saved, cancelled } = await searchParams;
  const supabase = await createClient();

  const { data: court } = await supabase
    .from("courts")
    .select("id, name, location:locations(timezone)")
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();

  if (!court) {
    notFound();
  }

  const location = Array.isArray(court.location) ? court.location[0] : court.location;
  const timezone = location?.timezone ?? "UTC";

  const { data: rules } = await supabase
    .from("availability_rules")
    .select("day_of_week, open_time, close_time")
    .eq("court_id", court.id);

  const rulesByDay = new Map((rules ?? []).map((r) => [r.day_of_week, r]));

  const { data: upcomingBookings } = await supabase
    .from("bookings")
    .select("id, start_time, end_time, requested_net_height, requested_court_lines")
    .eq("court_id", court.id)
    .eq("status", "confirmed")
    .gte("start_time", new Date().toISOString())
    .order("start_time");

  return (
    <div>
      <Link href={`/admin/locations/${locationId}`} className="text-sm underline">
        &larr; Courts
      </Link>

      <h2 className="mt-4 text-lg font-medium">Weekly availability — {court.name}</h2>
      <p className="mt-1 text-sm text-gray-600">
        Leave both times blank for a day the court is closed. Saving replaces the full week.
      </p>

      <form action={saveAvailability} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="court_id" value={court.id} />
        <input type="hidden" name="location_id" value={locationId} />
        {DAY_NAMES.map((name, day) => {
          const rule = rulesByDay.get(day);
          return (
            <div key={day} className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-center sm:gap-3">
              <label className="text-sm font-medium">{name}</label>
              <input
                type="time"
                name={`open_${day}`}
                defaultValue={rule?.open_time?.slice(0, 5)}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <input
                type="time"
                name={`close_${day}`}
                defaultValue={rule?.close_time?.slice(0, 5)}
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
          );
        })}
        <button type="submit" className="mt-4 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
        {saved && <SuccessBanner>Availability saved.</SuccessBanner>}
      </form>

      <h2 className="mt-10 text-lg font-medium">Upcoming bookings</h2>

      {cancelled && <SuccessBanner>Booking cancelled.</SuccessBanner>}

      {(!upcomingBookings || upcomingBookings.length === 0) && (
        <p className="mt-1 text-sm text-gray-600">No upcoming bookings.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(upcomingBookings ?? []).map((booking) => {
          const dateLabel = formatBookingDate(booking.start_time, timezone);
          const timeLabel = `${formatInTimeZone(new Date(booking.start_time), timezone, "h:mm a")} – ${formatInTimeZone(new Date(booking.end_time), timezone, "h:mm a")}`;
          return (
            <li key={booking.id} className="rounded border border-gray-300 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {dateLabel} · {timeLabel}
                </p>
                <form action={cancelBooking}>
                  <input type="hidden" name="booking_id" value={booking.id} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <input type="hidden" name="court_id" value={court.id} />
                  <input
                    type="hidden"
                    name="redirect_to"
                    value={`/admin/locations/${locationId}/courts/${court.id}`}
                  />
                  <button type="submit" className="text-xs text-red-700 underline">
                    Cancel
                  </button>
                </form>
              </div>

              <form
                action={updateBookingConfig}
                className="mt-2 flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="booking_id" value={booking.id} />
                <input type="hidden" name="location_id" value={locationId} />
                <input type="hidden" name="court_id" value={court.id} />
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  Net height
                  <select
                    name="requested_net_height"
                    defaultValue={booking.requested_net_height ?? ""}
                    className="rounded border px-2 py-1 text-sm"
                  >
                    {NET_HEIGHT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  Court lines
                  <select
                    name="requested_court_lines"
                    defaultValue={booking.requested_court_lines ?? ""}
                    className="rounded border px-2 py-1 text-sm"
                  >
                    {COURT_LINES_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="text-xs underline">
                  Save
                </button>
                {config_saved === booking.id && <span className="text-xs text-green-800">Saved.</span>}
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
