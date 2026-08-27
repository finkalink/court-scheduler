import { fromZonedTime } from "date-fns-tz";

// A day (in the weekly template) or a specific date (in an override) can
// have more than one open range -- e.g. 9am-12pm and 4-9pm -- so both the
// admin forms and the DB rows are capped at this many ranges each.
export const MAX_RANGES_PER_DAY = 3;

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

interface ComputeOpenSlotsParams {
  date: string; // "YYYY-MM-DD", the calendar date in the location's timezone
  timezone: string; // IANA zone, e.g. "America/Los_Angeles"
  rules: AvailabilityRule[];
  overrides: SlotOverride[];
  bookedRanges: BookedRange[];
  durationMinutes?: number; // length of a single booking
  stepMinutes?: number; // granularity of offered start times (rolling window)
}

function dayOfWeekFor(date: string): number {
  // Noon UTC avoids any date-boundary ambiguity; the calendar date itself
  // (not an instant) is what determines day-of-week, independent of timezone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function computeOpenSlots({
  date,
  timezone,
  rules,
  overrides,
  bookedRanges,
  durationMinutes = 60,
  stepMinutes = 15,
}: ComputeOpenSlotsParams): Slot[] {
  // A date can have several override rows (one per custom range); any of
  // them marked is_closed takes precedence over the rest.
  const dayOverrides = overrides.filter((o) => o.date === date);

  let ranges: { open: string; close: string }[];

  if (dayOverrides.some((o) => o.is_closed)) {
    return [];
  } else if (dayOverrides.length > 0) {
    ranges = dayOverrides
      .filter((o) => o.custom_open && o.custom_close)
      .map((o) => ({ open: o.custom_open!, close: o.custom_close! }));
  } else {
    const dow = dayOfWeekFor(date);
    ranges = rules.filter((r) => r.day_of_week === dow).map((r) => ({ open: r.open_time, close: r.close_time }));
  }

  if (ranges.length === 0) return [];

  const bookedMs = bookedRanges.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime(),
  }));

  const stepMs = stepMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  // Ranges can be adjacent or (in theory) overlap, so start times are
  // deduped across ranges before being returned.
  const seenStarts = new Set<number>();
  const slots: Slot[] = [];

  for (const { open, close } of ranges) {
    const openInstant = fromZonedTime(`${date}T${open}`, timezone);
    const closeInstant = fromZonedTime(`${date}T${close}`, timezone);

    for (
      let start = openInstant.getTime();
      start + durationMs <= closeInstant.getTime();
      start += stepMs
    ) {
      if (seenStarts.has(start)) continue;
      const end = start + durationMs;
      const overlapsBooking = bookedMs.some((b) => start < b.end && end > b.start);
      if (!overlapsBooking) {
        seenStarts.add(start);
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  return slots;
}
