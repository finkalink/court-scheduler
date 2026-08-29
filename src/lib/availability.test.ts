import { describe, expect, it } from "vitest";
import {
  resolveDayHours,
  generateSlotStarts,
  computeOpenSlots,
  type AvailabilityRule,
  type SlotOverride,
  type BlockedSlot,
} from "@/lib/availability";

describe("resolveDayHours", () => {
  const rules: AvailabilityRule[] = [
    { day_of_week: 1, open_time: "09:00:00", close_time: "21:00:00" }, // Monday
  ];

  it("returns the weekly rule's hours when there's no override", () => {
    // 2026-08-31 is a Monday
    expect(resolveDayHours("2026-08-31", rules, [])).toEqual({
      openTime: "09:00:00",
      closeTime: "21:00:00",
    });
  });

  it("returns null when there's no rule for that day of week", () => {
    // 2026-08-30 is a Sunday, no rule
    expect(resolveDayHours("2026-08-30", rules, [])).toBeNull();
  });

  it("returns null when the day is closed by an override", () => {
    const overrides: SlotOverride[] = [
      { date: "2026-08-31", is_closed: true, custom_open: null, custom_close: null },
    ];
    expect(resolveDayHours("2026-08-31", rules, overrides)).toBeNull();
  });

  it("returns the override's custom hours when both are set", () => {
    const overrides: SlotOverride[] = [
      { date: "2026-08-31", is_closed: false, custom_open: "10:00", custom_close: "14:00" },
    ];
    expect(resolveDayHours("2026-08-31", rules, overrides)).toEqual({
      openTime: "10:00",
      closeTime: "14:00",
    });
  });

  it("falls back to the weekly rule when the override has only a partial custom time", () => {
    const overrides: SlotOverride[] = [
      { date: "2026-08-31", is_closed: false, custom_open: "10:00", custom_close: null },
    ];
    expect(resolveDayHours("2026-08-31", rules, overrides)).toEqual({
      openTime: "09:00:00",
      closeTime: "21:00:00",
    });
  });
});

describe("generateSlotStarts", () => {
  it("generates evenly-divided slots across the window", () => {
    expect(generateSlotStarts("09:00:00", "11:00:00", 60)).toEqual(["09:00:00", "10:00:00"]);
  });

  it("stops before a slot would run past the close time", () => {
    expect(generateSlotStarts("09:00:00", "10:30:00", 60)).toEqual(["09:00:00"]);
  });

  it("handles a step that leaves a remainder at the end of the window", () => {
    expect(generateSlotStarts("09:00:00", "10:15:00", 30)).toEqual(["09:00:00", "09:30:00"]);
  });

  it("returns an empty array when the window is shorter than one step", () => {
    expect(generateSlotStarts("09:00:00", "09:20:00", 30)).toEqual([]);
  });

  it("returns an empty array when open equals close", () => {
    expect(generateSlotStarts("09:00:00", "09:00:00", 30)).toEqual([]);
  });

  it("accepts HH:MM inputs without seconds", () => {
    expect(generateSlotStarts("09:00", "10:00", 30)).toEqual(["09:00:00", "09:30:00"]);
  });
});

describe("computeOpenSlots blocking", () => {
  const rules: AvailabilityRule[] = [
    { day_of_week: 1, open_time: "09:00:00", close_time: "11:00:00" }, // Monday
    { day_of_week: 2, open_time: "09:00:00", close_time: "11:00:00" }, // Tuesday
  ];

  it("excludes a slot blocked recurringly on that day of week", () => {
    // 2026-08-31 is a Monday
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual(["2026-08-31T09:00:00.000Z"]);
  });

  it("does not exclude the same time on a different day of week", () => {
    // 2026-09-01 is a Tuesday
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-09-01",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T10:00:00.000Z",
    ]);
  });

  it("excludes a slot blocked for one specific date only", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: null, date: "2026-08-31", start_time: "09:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual(["2026-08-31T10:00:00.000Z"]);
  });

  it("does not exclude the same time on a different date", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: null, date: "2026-08-31", start_time: "09:00:00" }];
    // 2026-09-07 is also a Monday, but a different specific date
    const slots = computeOpenSlots({
      date: "2026-09-07",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-07T10:00:00.000Z",
    ]);
  });

  it("combines correctly with an existing booked range", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [{ start_time: "2026-08-31T09:00:00.000Z", end_time: "2026-08-31T10:00:00.000Z" }],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots).toEqual([]);
  });

  it("defaults to no blocking when blockedSlots is omitted", () => {
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-08-31T09:00:00.000Z",
      "2026-08-31T10:00:00.000Z",
    ]);
  });
});
