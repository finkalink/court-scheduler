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
