import { describe, expect, it } from "vitest";
import { buildMapsUrl, isApplePlatform } from "@/lib/maps";

describe("isApplePlatform", () => {
  it("detects iOS user agents", () => {
    expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
  });

  it("returns false for non-iOS or missing user agents", () => {
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isApplePlatform(null)).toBe(false);
  });
});

describe("buildMapsUrl", () => {
  it("prefers coordinates over address text when both are available", () => {
    const url = buildMapsUrl({
      latitude: 37.4224858,
      longitude: -122.0855846,
      address: "1600 Amphitheatre Parkway",
      userAgent: null,
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=37.4224858%2C-122.0855846"
    );
  });

  it("falls back to the address text when coordinates are missing", () => {
    const url = buildMapsUrl({
      latitude: null,
      longitude: null,
      address: "123 Court St",
      userAgent: null,
    });
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=123%20Court%20St");
  });

  it("routes to Apple Maps for an iOS user agent", () => {
    const url = buildMapsUrl({
      latitude: 37.4224858,
      longitude: -122.0855846,
      address: null,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    expect(url).toBe("https://maps.apple.com/?q=37.4224858%2C-122.0855846");
  });

  it("returns null when there is neither an address nor coordinates", () => {
    const url = buildMapsUrl({ latitude: null, longitude: null, address: null, userAgent: null });
    expect(url).toBeNull();
  });
});
