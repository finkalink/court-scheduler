import { describe, expect, it } from "vitest";
import { resolveDayHours, type AvailabilityRule, type SlotOverride } from "@/lib/availability";

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
