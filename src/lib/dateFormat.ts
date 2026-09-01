import { formatInTimeZone } from "date-fns-tz";

const DATE_FORMAT = "EEEE, M/d/yyyy";

// For a real instant (e.g. a booking's start_time) -- formatted in the
// given location's timezone.
export function formatBookingDate(instant: Date | string, timezone: string): string {
  return formatInTimeZone(new Date(instant), timezone, DATE_FORMAT);
}

// For a plain "YYYY-MM-DD" calendar date (e.g. the day being browsed).
// Noon UTC keeps the date stable regardless of the viewer's zone, matching
// the same trick availability.ts uses for day-of-week lookups.
export function formatCalendarDate(dateString: string): string {
  return formatInTimeZone(`${dateString}T12:00:00Z`, "UTC", DATE_FORMAT);
}

// For a set of event sessions -- the full calendar-day span they cover in
// the given timezone, as either one date ("Wednesday, 4/2/2027") or a range
// ("Wednesday, 4/2/2027 -- Friday, 4/4/2027") when sessions land on
// different calendar days there. null for no sessions at all.
export function formatEventDateRange(
  sessions: { start_time: string }[],
  timezone: string
): string | null {
  if (sessions.length === 0) return null;

  const dayKeys = sessions.map((s) => formatInTimeZone(new Date(s.start_time), timezone, "yyyy-MM-dd"));
  const earliestKey = dayKeys.reduce((min, key) => (key < min ? key : min));
  const latestKey = dayKeys.reduce((max, key) => (key > max ? key : max));

  const earliest = formatCalendarDate(earliestKey);
  if (earliestKey === latestKey) return earliest;

  return `${earliest} – ${formatCalendarDate(latestKey)}`;
}

// For a plain "HH:MM" (or "HH:MM:SS") time of day with no associated date or
// timezone -- e.g. an availability_rules/slot_overrides open/close time.
export function formatTimeOfDay(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour24 = Number(hourStr);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minuteStr} ${period}`;
}
