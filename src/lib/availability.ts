import { fromZonedTime } from "date-fns-tz";

export interface AvailabilityRule {
  day_of_week: number; // 0 = Sunday .. 6 = Saturday
  open_time: string; // "HH:MM:SS"
  close_time: string; // "HH:MM:SS"
}

export interface SlotOverride {
  date: string; // "YYYY-MM-DD"
  is_closed: boolean;
  custom_open: string | null;
  custom_close: string | null;
}

export interface BookedRange {
  start_time: string; // ISO instant
  end_time: string; // ISO instant
}

export interface Slot {
  start: string; // ISO instant (UTC)
  end: string; // ISO instant (UTC)
}

export interface BlockedSlot {
  day_of_week: number | null; // set for a recurring block; null for a date-specific one
  date: string | null; // "YYYY-MM-DD"; set for a date-specific block; null for recurring
  start_time: string; // "HH:MM:SS"
}

interface ComputeOpenSlotsParams {
  date: string; // "YYYY-MM-DD", the calendar date in the location's timezone
  timezone: string; // IANA zone, e.g. "America/Los_Angeles"
  rules: AvailabilityRule[];
  overrides: SlotOverride[];
  bookedRanges: BookedRange[];
  blockedSlots?: BlockedSlot[]; // per-slot blocks, recurring or date-specific
  durationMinutes?: number; // length of a single booking
  stepMinutes?: number; // granularity of offered start times (rolling window)
}

export function dayOfWeekFor(date: string): number {
  // Noon UTC avoids any date-boundary ambiguity; the calendar date itself
  // (not an instant) is what determines day-of-week, independent of timezone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutesAsTime(totalMinutes: number): string {
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

// Candidate start times ("HH:MM:SS") within [openTime, closeTime) at the
// given step -- used both by computeOpenSlots below and by the admin
// blocked-slots grid builder (src/lib/blockedSlots.ts).
export function generateSlotStarts(
  openTime: string,
  closeTime: string,
  stepMinutes: number
): string[] {
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);
  const starts: string[] = [];
  for (let m = openMin; m + stepMinutes <= closeMin; m += stepMinutes) {
    starts.push(formatMinutesAsTime(m));
  }
  return starts;
}

export interface DayHours {
  openTime: string; // "HH:MM" or "HH:MM:SS"
  closeTime: string;
}

// The open/close window for a single calendar date: an override closes the
// day, or supplies its own hours (only when both custom times are set);
// otherwise falls back to the weekly rule. Returns null when there's no
// window at all (closed override, or no rule for that day of week).
export function resolveDayHours(
  date: string,
  rules: AvailabilityRule[],
  overrides: SlotOverride[]
): DayHours | null {
  const override = overrides.find((o) => o.date === date);

  if (override?.is_closed) {
    return null;
  }

  if (override?.custom_open && override?.custom_close) {
    return { openTime: override.custom_open, closeTime: override.custom_close };
  }

  const rule = rules.find((r) => r.day_of_week === dayOfWeekFor(date));
  if (!rule) return null;
  return { openTime: rule.open_time, closeTime: rule.close_time };
}

export function computeOpenSlots({
  date,
  timezone,
  rules,
  overrides,
  bookedRanges,
  blockedSlots = [],
  durationMinutes = 60,
  stepMinutes = 15,
}: ComputeOpenSlotsParams): Slot[] {
  const hours = resolveDayHours(date, rules, overrides);
  if (!hours) return [];

  const openInstant = fromZonedTime(`${date}T${hours.openTime}`, timezone);
  const closeInstant = fromZonedTime(`${date}T${hours.closeTime}`, timezone);

  const bookedMs = bookedRanges.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime(),
  }));

  const dow = dayOfWeekFor(date);
  const blockedStarts = new Set(
    blockedSlots
      .filter((b) => b.day_of_week === dow || b.date === date)
      .map((b) => b.start_time.slice(0, 5))
  );
  const openMinutes = parseTimeToMinutes(hours.openTime);

  const slots: Slot[] = [];
  const stepMs = stepMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  let i = 0;
  for (
    let start = openInstant.getTime();
    start + durationMs <= closeInstant.getTime();
    start += stepMs, i++
  ) {
    const end = start + durationMs;
    const overlapsBooking = bookedMs.some((b) => start < b.end && end > b.start);
    const wallStart = formatMinutesAsTime(openMinutes + i * stepMinutes).slice(0, 5);
    const isBlocked = blockedStarts.has(wallStart);
    if (!overlapsBooking && !isBlocked) {
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }

  return slots;
}
