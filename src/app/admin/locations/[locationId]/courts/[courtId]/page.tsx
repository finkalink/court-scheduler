import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  saveAvailability,
  updateBookingConfig,
  saveDateOverride,
  clearDateOverride,
} from "@/app/admin/actions";
import { cancelBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate, formatCalendarDate } from "@/lib/dateFormat";
import SuccessBanner from "@/components/SuccessBanner";
import WeeklyHoursFields, { HourRangeFields } from "@/components/WeeklyHoursFields";

export default async function AdminCourtAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; courtId: string }>;
  searchParams: Promise<{
    saved?: string;
    config_saved?: string;
    cancelled?: string;
    override_saved?: string;
    override_cleared?: string;
  }>;
}) {
  const { locationId, courtId } = await params;
  const { saved, config_saved, cancelled, override_saved, override_cleared } = await searchParams;
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

  const rangesByDay = new Map<number, { open_time: string; close_time: string }[]>();
  for (const rule of rules ?? []) {
    const existing = rangesByDay.get(rule.day_of_week) ?? [];
    existing.push(rule);
    rangesByDay.set(rule.day_of_week, existing);
  }

  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const { data: overrides } = await supabase
    .from("slot_overrides")
    .select("date, is_closed, custom_open, custom_close")
    .eq("court_id", court.id)
    .gte("date", today)
    .order("date");

  const overridesByDate = new Map<
    string,
    { is_closed: boolean; ranges: { open_time: string; close_time: string }[] }
  >();
  for (const o of overrides ?? []) {
    const existing = overridesByDate.get(o.date) ?? { is_closed: false, ranges: [] };
    if (o.is_closed) {
      existing.is_closed = true;
    } else if (o.custom_open && o.custom_close) {
      existing.ranges.push({ open_time: o.custom_open, close_time: o.custom_close });
    }
    overridesByDate.set(o.date, existing);
  }

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
        Leave a day&apos;s rows blank to close it. Add more than one range for split hours (e.g.
        9:00 AM–12:00 PM and 4:00–9:00 PM). Saving replaces the full week.
      </p>

      <form action={saveAvailability} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="court_id" value={court.id} />
        <input type="hidden" name="location_id" value={locationId} />
        <WeeklyHoursFields rangesByDay={rangesByDay} />
        <button type="submit" className="mt-4 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
        {saved && <SuccessBanner>Availability saved.</SuccessBanner>}
      </form>

      <h2 className="mt-10 text-lg font-medium">Custom hours for a specific date</h2>
      <p className="mt-1 text-sm text-gray-600">
        Override the weekly schedule above for one date — block off part of a day for
        maintenance, close entirely, or open different hours.
      </p>

      {override_cleared && <SuccessBanner>Custom hours removed for {formatCalendarDate(override_cleared)}.</SuccessBanner>}

      {(overridesByDate.size === 0) && (
        <p className="mt-2 text-sm text-gray-600">No upcoming custom dates.</p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {Array.from(overridesByDate.entries()).map(([date, entry]) => (
          <li key={date} className="flex items-center justify-between rounded border border-gray-300 px-4 py-2 text-sm">
            <div>
              <span className="font-medium">{formatCalendarDate(date)}</span>
              {" — "}
              {entry.is_closed
                ? "Closed all day"
                : entry.ranges
                    .map(
                      (r) =>
                        `${r.open_time.slice(0, 5)}–${r.close_time.slice(0, 5)}`
                    )
                    .join(", ")}
              {override_saved === date && <span className="ml-2 text-xs text-green-800">Saved.</span>}
            </div>
            <form action={clearDateOverride}>
              <input type="hidden" name="court_id" value={court.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <input type="hidden" name="date" value={date} />
              <button type="submit" className="text-xs text-red-700 underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      <details className="mt-4">
        <summary className="w-fit cursor-pointer text-sm underline">Add or edit a custom date</summary>
        <form action={saveDateOverride} className="mt-3 flex max-w-sm flex-col gap-3">
          <input type="hidden" name="court_id" value={court.id} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Date
            <input type="date" name="date" required min={today} className="rounded border px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_closed" />
            Closed all day
          </label>
          <div>
            <p className="mb-1 text-xs text-gray-600">
              Or set custom hours (ignored if &quot;Closed all day&quot; is checked):
            </p>
            <HourRangeFields prefix="date" ranges={[]} />
          </div>
          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
            Save
          </button>
        </form>
      </details>

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
