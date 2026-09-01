import { describe, expect, it } from "vitest";
import { formatEventDateRange } from "@/lib/dateFormat";

describe("formatEventDateRange", () => {
  it("returns null when there are no sessions", () => {
    expect(formatEventDateRange([], "America/New_York")).toBeNull();
  });

  it("formats a single session as one date", () => {
    const sessions = [{ start_time: "2027-04-02T14:00:00Z" }];
    expect(formatEventDateRange(sessions, "America/New_York")).toBe("Friday, 4/2/2027");
  });

  it("formats same-day sessions as one date, not a range", () => {
    const sessions = [
      { start_time: "2027-04-02T14:00:00Z" },
      { start_time: "2027-04-02T18:00:00Z" },
    ];
    expect(formatEventDateRange(sessions, "America/New_York")).toBe("Friday, 4/2/2027");
  });

  it("formats sessions spanning multiple days as a range", () => {
    const sessions = [
      { start_time: "2027-04-02T14:00:00Z" },
      { start_time: "2027-04-04T14:00:00Z" },
    ];
    expect(formatEventDateRange(sessions, "America/New_York")).toBe(
      "Friday, 4/2/2027 – Sunday, 4/4/2027"
    );
  });

  it("uses the earliest and latest session regardless of input order", () => {
    const sessions = [
      { start_time: "2027-04-04T14:00:00Z" },
      { start_time: "2027-04-02T14:00:00Z" },
      { start_time: "2027-04-03T14:00:00Z" },
    ];
    expect(formatEventDateRange(sessions, "America/New_York")).toBe(
      "Friday, 4/2/2027 – Sunday, 4/4/2027"
    );
  });

  it("respects the location's timezone when determining calendar day boundaries", () => {
    // 2027-04-03T02:00:00Z is still 2027-04-02 in America/Los_Angeles (UTC-7 in April).
    const sessions = [
      { start_time: "2027-04-02T20:00:00Z" },
      { start_time: "2027-04-03T02:00:00Z" },
    ];
    expect(formatEventDateRange(sessions, "America/Los_Angeles")).toBe("Friday, 4/2/2027");
  });
});
