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
  const override = overrides.find((o) => o.date === date);

  if (override?.is_closed) {
    return [];
  }

  let openTime: string | null = null;
  let closeTime: string | null = null;

  if (override?.custom_open && override?.custom_close) {
    openTime = override.custom_open;
    closeTime = override.custom_close;
  } else {
    const rule = rules.find((r) => r.day_of_week === dayOfWeekFor(date));
    if (!rule) return [];
    openTime = rule.open_time;
    closeTime = rule.close_time;
  }

  const openInstant = fromZonedTime(`${date}T${openTime}`, timezone);
  const closeInstant = fromZonedTime(`${date}T${closeTime}`, timezone);

  const bookedMs = bookedRanges.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime(),
  }));

  const slots: Slot[] = [];
  const stepMs = stepMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  for (
    let start = openInstant.getTime();
    start + durationMs <= closeInstant.getTime();
    start += stepMs
  ) {
    const end = start + durationMs;
    const overlapsBooking = bookedMs.some((b) => start < b.end && end > b.start);
    if (!overlapsBooking) {
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }

  return slots;
}
