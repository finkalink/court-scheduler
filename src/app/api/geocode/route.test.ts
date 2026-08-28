import { describe, expect, it } from "vitest";
import { extractCity } from "@/app/api/geocode/route";

describe("extractCity", () => {
  it("returns null for an undefined address", () => {
    expect(extractCity(undefined)).toBeNull();
  });

  it("prefers city over town, village, hamlet", () => {
    expect(
      extractCity({ city: "Los Angeles", town: "Ignored", village: "Ignored", hamlet: "Ignored" })
    ).toBe("Los Angeles");
  });

  it("falls back to town when city is missing", () => {
    expect(extractCity({ town: "Chewsday" })).toBe("Chewsday");
  });

  it("falls back to village when city and town are missing", () => {
    expect(extractCity({ village: "Smallville" })).toBe("Smallville");
  });

  it("falls back to hamlet when city, town, and village are missing", () => {
    expect(extractCity({ hamlet: "Tiny Hamlet" })).toBe("Tiny Hamlet");
  });

  it("returns null when nothing in the fallback chain is present", () => {
    expect(extractCity({ state: "California" })).toBeNull();
  });
});
