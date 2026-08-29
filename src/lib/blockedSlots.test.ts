import { describe, expect, it } from "vitest";
import { buildSlotGrid } from "@/lib/blockedSlots";

describe("buildSlotGrid", () => {
  it("marks slots as open when nothing is blocked", () => {
    expect(buildSlotGrid("09:00:00", "11:00:00", 60, [])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "10:00:00", blocked: false },
    ]);
  });

  it("marks a matching slot as blocked", () => {
    expect(buildSlotGrid("09:00:00", "11:00:00", 60, ["10:00:00"])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "10:00:00", blocked: true },
    ]);
  });

  it("matches blocked times ignoring seconds precision", () => {
    expect(buildSlotGrid("09:00:00", "10:00:00", 30, ["09:30"])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "09:30:00", blocked: true },
    ]);
  });

  it("returns an empty array when the window has no slots", () => {
    expect(buildSlotGrid("09:00:00", "09:00:00", 30, [])).toEqual([]);
  });
});
