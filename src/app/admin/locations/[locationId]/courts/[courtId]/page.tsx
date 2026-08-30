import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  saveAvailability,
  updateBookingConfig,
  saveSlotOverride,
  deleteSlotOverride,
  toggleBlockedSlot,
} from "@/app/admin/actions";
import { cancelBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate, formatCalendarDate, formatTimeOfDay } from "@/lib/dateFormat";
import { resolveDayHours, type AvailabilityRule, type SlotOverride } from "@/lib/availability";
import { buildSlotGrid } from "@/lib/blockedSlots";
import SuccessBanner from "@/components/SuccessBanner";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
    override_deleted?: string;
    override_error?: string;
    block_mode?: string;
    block_day?: string;
    block_date?: string;
  }>;
}) {
  const { locationId, courtId } = await params;
  const {
    saved,
    config_saved,
    cancelled,
    override_saved,
    override_deleted,
    override_error,
    block_mode: blockModeParam,
    block_day: blockDayParam,
    block_date: blockDateParam,
  } = await searchParams;
  const supabase = await createClient();

  const { data: court } = await supabase
    .from("courts")
    .select("id, name, slot_size_minutes, location:locations(timezone)")
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

  const { data: overrides } = await supabase
    .from("slot_overrides")
    .select("id, date, is_closed, custom_open, custom_close")
    .eq("court_id", court.id)
    .gte("date", formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"))
    .order("date");

  const blockMode = blockModeParam === "date" ? "date" : "recurring";
  const todayDateStr = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const todayDayOfWeek = new Date(`${todayDateStr}T12:00:00Z`).getUTCDay();
  const blockDay = blockDayParam ? Number(blockDayParam) : todayDayOfWeek;
  const blockDate = blockDateParam ?? todayDateStr;
  const slotSizeMinutes = court.slot_size_minutes ?? 60;

  let blockWindow: { openTime: string; closeTime: string } | null = null;
  if (blockMode === "recurring") {
    const rule = rulesByDay.get(blockDay);
    blockWindow = rule ? { openTime: rule.open_time, closeTime: rule.close_time } : null;
  } else {
    blockWindow = resolveDayHours(
      blockDate,
      (rules ?? []) as AvailabilityRule[],
      (overrides ?? []) as SlotOverride[]
    );
  }

  const { data: blockedSlotRows } =
    blockMode === "recurring"
      ? await supabase
          .from("blocked_slots")
          .select("start_time")
          .eq("court_id", court.id)
          .eq("day_of_week", blockDay)
      : await supabase
          .from("blocked_slots")
          .select("start_time")
          .eq("court_id", court.id)
          .eq("date", blockDate);

  const slotGrid = blockWindow
    ? buildSlotGrid(
        blockWindow.openTime,
        blockWindow.closeTime,
        slotSizeMinutes,
        (blockedSlotRows ?? []).map((r) => r.start_time)
      )
    : [];

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

      <h1 className="mt-4 text-lg font-medium">Weekly Availability — {court.name}</h1>
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

      <h2 className="mt-10 text-lg font-medium">Date Overrides</h2>
      <p className="mt-1 text-sm text-gray-600">
        One-off exceptions to the weekly hours above — a holiday closure, or a single day with
        different hours.
      </p>

      {override_saved && <SuccessBanner>Override saved.</SuccessBanner>}
      {override_deleted && <SuccessBanner>Override removed.</SuccessBanner>}
      {override_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {override_error}
        </p>
      )}

      {(!overrides || overrides.length === 0) && (
        <p className="mt-1 text-sm text-gray-600">No upcoming overrides.</p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {(overrides ?? []).map((override) => (
          <li
            key={override.id}
            className="flex items-center justify-between rounded border border-gray-300 px-4 py-2"
          >
            <span className="text-sm">
              {formatCalendarDate(override.date)} —{" "}
              {override.is_closed
                ? "Closed"
                : `${formatTimeOfDay(override.custom_open!)} – ${formatTimeOfDay(override.custom_close!)}`}
            </span>
            <form action={deleteSlotOverride}>
              <input type="hidden" name="override_id" value={override.id} />
              <input type="hidden" name="court_id" value={court.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="text-xs text-red-700 underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={saveSlotOverride} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="court_id" value={court.id} />
        <input type="hidden" name="location_id" value={locationId} />
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Date
          <input type="date" name="date" required className="rounded border px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" name="is_closed" />
          Closed all day
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Custom open
          <input type="time" name="custom_open" className="rounded border px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Custom close
          <input type="time" name="custom_close" className="rounded border px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Add Override
        </button>
      </form>

      <h2 className="mt-10 text-lg font-medium">Blocked Slots</h2>
      <p className="mt-1 text-sm text-gray-600">
        Block off specific times within the hours above — a recurring break, or a one-off
        private event.
      </p>

      <div className="mt-3 flex gap-4 text-sm">
        <Link
          href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=recurring&block_day=${blockDay}`}
          className={blockMode === "recurring" ? "font-medium underline" : "text-gray-600 underline"}
        >
          Recurring
        </Link>
        <Link
          href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=date&block_date=${blockDate}`}
          className={blockMode === "date" ? "font-medium underline" : "text-gray-600 underline"}
        >
          Specific date
        </Link>
      </div>

      {blockMode === "recurring" ? (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {DAY_NAMES.map((name, day) => (
            <Link
              key={day}
              href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=recurring&block_day=${day}`}
              className={`rounded border px-2 py-1 ${
                day === blockDay
                  ? "border-black font-medium dark:border-white"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {name.slice(0, 3)}
            </Link>
          ))}
        </div>
      ) : (
        <form method="get" className="mt-3 flex items-end gap-2">
          <input type="hidden" name="block_mode" value="date" />
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Date
            <input
              type="date"
              name="block_date"
              defaultValue={blockDate}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="rounded border border-gray-400 px-3 py-2 text-sm">
            View
          </button>
        </form>
      )}

      {blockWindow ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {slotGrid.map((slot) => (
            <form key={slot.startTime} action={toggleBlockedSlot}>
              <input type="hidden" name="court_id" value={court.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <input type="hidden" name="mode" value={blockMode} />
              <input type="hidden" name="start_time" value={slot.startTime} />
              <input type="hidden" name="currently_blocked" value={String(slot.blocked)} />
              {blockMode === "recurring" ? (
                <input type="hidden" name="day_of_week" value={blockDay} />
              ) : (
                <input type="hidden" name="date" value={blockDate} />
              )}
              <button
                type="submit"
                className={`rounded border px-3 py-2 text-sm ${
                  slot.blocked
                    ? "border-red-400 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                    : "border-gray-300"
                }`}
              >
                {formatTimeOfDay(slot.startTime)}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          {blockMode === "recurring"
            ? "This day is closed in the weekly schedule."
            : "This date is closed."}
        </p>
      )}

      <h2 className="mt-10 text-lg font-medium">Upcoming Bookings</h2>

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
