export interface CalendarEventDetails {
  title: string;
  startTime: string; // ISO instant
  endTime: string; // ISO instant
  location: string;
  description?: string | null;
  url?: string | null;
}

function toIcsDate(instant: string): string {
  return new Date(instant)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function toIso8601(instant: string): string {
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function buildGoogleCalendarUrl(event: CalendarEventDetails): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toIcsDate(event.startTime)}/${toIcsDate(event.endTime)}`,
    location: event.location,
  });
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookCalendarUrl(event: CalendarEventDetails): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: toIso8601(event.startTime),
    enddt: toIso8601(event.endTime),
    location: event.location,
  });
  if (event.description) params.set("body", event.description);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// RFC 5545 TEXT escaping -- backslash first so it doesn't double-escape the
// characters escaped after it.
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildIcsContent(event: CalendarEventDetails & { uid: string; nowInstant?: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Court Scheduler//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(event.nowInstant ?? new Date().toISOString())}`,
    `DTSTART:${toIcsDate(event.startTime)}`,
    `DTEND:${toIcsDate(event.endTime)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
