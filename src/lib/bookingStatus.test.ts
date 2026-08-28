import { describe, expect, it } from "vitest";
import { categorizeBookingTime, groupBookingsByTime, isCancellable } from "@/lib/bookingStatus";

describe("categorizeBookingTime", () => {
  const start = "2026-08-27T17:00:00.000Z";
  const end = "2026-08-27T18:00:00.000Z";

  it("is upcoming before the start time", () => {
    const now = new Date("2026-08-27T16:59:59.000Z");
    expect(categorizeBookingTime(start, end, now)).toBe("upcoming");
  });

  it("is in progress exactly at the start time", () => {
    const now = new Date("2026-08-27T17:00:00.000Z");
    expect(categorizeBookingTime(start, end, now)).toBe("in_progress");
  });

  it("is in progress partway through", () => {
    const now = new Date("2026-08-27T17:30:00.000Z");
    expect(categorizeBookingTime(start, end, now)).toBe("in_progress");
  });

  it("is past exactly at the end time", () => {
    const now = new Date("2026-08-27T18:00:00.000Z");
    expect(categorizeBookingTime(start, end, now)).toBe("past");
  });

  it("is past well after the end time", () => {
    const now = new Date("2026-08-28T00:00:00.000Z");
    expect(categorizeBookingTime(start, end, now)).toBe("past");
  });
});

describe("groupBookingsByTime", () => {
  type TestBooking = { id: string; start_time: string; end_time: string };

  const now = new Date("2026-08-27T17:30:00.000Z");

  const bookings: TestBooking[] = [
    // upcoming, unsorted -- should come out ascending (soonest first)
    { id: "upcoming-late", start_time: "2026-08-28T12:00:00.000Z", end_time: "2026-08-28T13:00:00.000Z" },
    { id: "upcoming-soon", start_time: "2026-08-27T18:00:00.000Z", end_time: "2026-08-27T19:00:00.000Z" },
    // in progress right now
    { id: "in-progress", start_time: "2026-08-27T17:00:00.000Z", end_time: "2026-08-27T18:00:00.000Z" },
    // past, unsorted -- should come out descending (most recent first)
    { id: "past-old", start_time: "2026-08-25T09:00:00.000Z", end_time: "2026-08-25T10:00:00.000Z" },
    { id: "past-recent", start_time: "2026-08-26T09:00:00.000Z", end_time: "2026-08-26T10:00:00.000Z" },
  ];

  it("buckets and sorts each group correctly", () => {
    const result = groupBookingsByTime(bookings, now);

    expect(result.upcoming.map((b) => b.id)).toEqual(["upcoming-soon", "upcoming-late"]);
    expect(result.inProgress.map((b) => b.id)).toEqual(["in-progress"]);
    expect(result.past.map((b) => b.id)).toEqual(["past-recent", "past-old"]);
  });

  it("returns empty groups for an empty list", () => {
    expect(groupBookingsByTime([], now)).toEqual({ upcoming: [], inProgress: [], past: [] });
  });
});

describe("isCancellable", () => {
  it("is cancellable only when confirmed and upcoming", () => {
    expect(isCancellable("confirmed", "upcoming")).toBe(true);
    expect(isCancellable("confirmed", "in_progress")).toBe(false);
    expect(isCancellable("confirmed", "past")).toBe(false);
    expect(isCancellable("cancelled", "upcoming")).toBe(false);
  });
});
