import { describe, expect, it } from "vitest";
import { buildBookingCancellationEmail, buildBookingConfirmationEmail } from "@/lib/email";

const baseDetails = {
  bookingId: "abc-123",
  dateLabel: "Wednesday, 8/26/2026",
  timeLabel: "9:00 AM – 10:00 AM",
  courtName: "Court 1",
  organizationName: "Ace Volleyball Club",
  requestedConfig: "Net: Women's · Lines: 4s",
  appUrl: "https://court-scheduler-gold.vercel.app",
  startTime: "2026-08-26T13:00:00.000Z",
  endTime: "2026-08-26T14:00:00.000Z",
};

describe("buildBookingConfirmationEmail", () => {
  it("includes the date, time, court, org, and requested config", () => {
    const email = buildBookingConfirmationEmail(baseDetails);
    expect(email.subject).toContain("Booking confirmed");
    expect(email.text).toContain("Wednesday, 8/26/2026");
    expect(email.text).toContain("9:00 AM – 10:00 AM");
    expect(email.text).toContain("Court 1");
    expect(email.text).toContain("Ace Volleyball Club");
    expect(email.text).toContain("Net: Women's · Lines: 4s");
    expect(email.html).toContain("Court 1");
  });

  it("links back to the booking detail page", () => {
    const email = buildBookingConfirmationEmail(baseDetails);
    expect(email.text).toContain("https://court-scheduler-gold.vercel.app/bookings/abc-123");
    expect(email.html).toContain("https://court-scheduler-gold.vercel.app/bookings/abc-123");
  });

  it("omits the requested config line when there is none", () => {
    const email = buildBookingConfirmationEmail({ ...baseDetails, requestedConfig: null });
    expect(email.text).not.toContain("Net:");
  });

  it("omits the org name when there is none", () => {
    const email = buildBookingConfirmationEmail({ ...baseDetails, organizationName: null });
    expect(email.text).not.toContain("undefined");
    expect(email.text).not.toContain("null");
  });

  it("includes add-to-calendar links for Google, Outlook, and .ics", () => {
    const email = buildBookingConfirmationEmail(baseDetails);
    expect(email.text).toContain("https://calendar.google.com/calendar/render");
    expect(email.text).toContain("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(email.text).toContain("https://court-scheduler-gold.vercel.app/api/bookings/abc-123/ics");
    expect(email.html).toContain("https://calendar.google.com/calendar/render");
    expect(email.html).toContain("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(email.html).toContain("https://court-scheduler-gold.vercel.app/api/bookings/abc-123/ics");
  });
});

describe("buildBookingCancellationEmail", () => {
  it("includes the date, time, and court of the cancelled booking", () => {
    const email = buildBookingCancellationEmail(baseDetails);
    expect(email.subject).toContain("Booking cancelled");
    expect(email.text).toContain("Wednesday, 8/26/2026");
    expect(email.text).toContain("9:00 AM – 10:00 AM");
    expect(email.text).toContain("Court 1");
  });

  it("does not link back to the (now cancelled) booking as something actionable", () => {
    const email = buildBookingCancellationEmail(baseDetails);
    expect(email.subject).not.toContain("confirmed");
  });
});
