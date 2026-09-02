import { describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl, buildIcsContent, buildOutlookCalendarUrl } from "@/lib/calendarLinks";

const baseEvent = {
  title: "Booking: Court 1",
  startTime: "2026-09-01T09:00:00.000Z",
  endTime: "2026-09-01T10:00:00.000Z",
  location: "Court 1 · Ace Volleyball Club",
  description: "Net: Women's · Lines: 4s",
  url: "https://court-scheduler-gold.vercel.app/bookings/abc-123",
};

describe("buildGoogleCalendarUrl", () => {
  it("encodes the event into a Google Calendar template link", () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(baseEvent.title);
    expect(url.searchParams.get("dates")).toBe("20260901T090000Z/20260901T100000Z");
    expect(url.searchParams.get("location")).toBe(baseEvent.location);
    expect(url.searchParams.get("details")).toBe(baseEvent.description);
  });

  it("omits details when there is no description", () => {
    const url = new URL(buildGoogleCalendarUrl({ ...baseEvent, description: null }));
    expect(url.searchParams.has("details")).toBe(false);
  });
});

describe("buildOutlookCalendarUrl", () => {
  it("encodes the event into an Outlook web compose link", () => {
    const url = new URL(buildOutlookCalendarUrl(baseEvent));
    expect(url.origin + url.pathname).toBe("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(url.searchParams.get("subject")).toBe(baseEvent.title);
    expect(url.searchParams.get("startdt")).toBe("2026-09-01T09:00:00Z");
    expect(url.searchParams.get("enddt")).toBe("2026-09-01T10:00:00Z");
    expect(url.searchParams.get("location")).toBe(baseEvent.location);
    expect(url.searchParams.get("body")).toBe(baseEvent.description);
  });
});

describe("buildIcsContent", () => {
  it("produces a valid VEVENT with the event's fields", () => {
    const ics = buildIcsContent({ ...baseEvent, uid: "abc-123@court-scheduler.app" });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:abc-123@court-scheduler.app\r\n");
    expect(ics).toContain("DTSTART:20260901T090000Z\r\n");
    expect(ics).toContain("DTEND:20260901T100000Z\r\n");
    expect(ics).toContain("SUMMARY:Booking: Court 1\r\n");
    expect(ics).toContain("LOCATION:Court 1 · Ace Volleyball Club\r\n");
    expect(ics).toContain(`URL:${baseEvent.url}\r\n`);
    expect(ics.trim().startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("escapes commas, semicolons, and newlines in free text fields", () => {
    const ics = buildIcsContent({
      ...baseEvent,
      title: "Booking; VIP, guest",
      description: "Line one\nLine two",
      uid: "abc-123@court-scheduler.app",
    });
    expect(ics).toContain("SUMMARY:Booking\\; VIP\\, guest\r\n");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\r\n");
  });

  it("omits DESCRIPTION and URL when not provided", () => {
    const ics = buildIcsContent({ ...baseEvent, description: null, url: null, uid: "abc-123@court-scheduler.app" });
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("URL:");
  });
});
