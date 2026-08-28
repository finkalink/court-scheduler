import { describe, expect, it } from "vitest";
import { validateSlotOverride } from "@/lib/slotOverride";

describe("validateSlotOverride", () => {
  it("requires a date", () => {
    const result = validateSlotOverride({ date: "", isClosed: true, customOpen: "", customClose: "" });
    expect(result).toEqual({ valid: false, error: "Pick a date." });
  });

  it("accepts a closed day with no custom times", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: true,
      customOpen: "",
      customClose: "",
    });
    expect(result).toEqual({
      valid: true,
      value: { date: "2026-09-01", is_closed: true, custom_open: null, custom_close: null },
    });
  });

  it("ignores stray custom times when closed", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: true,
      customOpen: "09:00",
      customClose: "17:00",
    });
    expect(result).toEqual({
      valid: true,
      value: { date: "2026-09-01", is_closed: true, custom_open: null, custom_close: null },
    });
  });

  it("accepts custom hours when not closed", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: false,
      customOpen: "09:00",
      customClose: "17:00",
    });
    expect(result).toEqual({
      valid: true,
      value: { date: "2026-09-01", is_closed: false, custom_open: "09:00", custom_close: "17:00" },
    });
  });

  it("rejects a custom open with no close", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: false,
      customOpen: "09:00",
      customClose: "",
    });
    expect(result).toEqual({
      valid: false,
      error: "Provide both a custom open and close time, or mark the day closed.",
    });
  });

  it("rejects a custom close with no open", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: false,
      customOpen: "",
      customClose: "17:00",
    });
    expect(result).toEqual({
      valid: false,
      error: "Provide both a custom open and close time, or mark the day closed.",
    });
  });

  it("rejects when neither closed nor custom hours are given", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: false,
      customOpen: "",
      customClose: "",
    });
    expect(result).toEqual({
      valid: false,
      error: "Provide both a custom open and close time, or mark the day closed.",
    });
  });

  it("rejects an open time that isn't before the close time", () => {
    const result = validateSlotOverride({
      date: "2026-09-01",
      isClosed: false,
      customOpen: "17:00",
      customClose: "17:00",
    });
    expect(result).toEqual({
      valid: false,
      error: "Custom open time must be before the close time.",
    });
  });
});
