import { describe, expect, it } from "vitest";
import { parseSocialHandle, buildSocialUrl } from "./socialLinks";

describe("parseSocialHandle", () => {
  it("returns an empty string for empty input", () => {
    expect(parseSocialHandle("instagram", "")).toBe("");
    expect(parseSocialHandle("instagram", "   ")).toBe("");
  });

  it("passes through a bare handle unchanged", () => {
    expect(parseSocialHandle("instagram", "acevolleyball")).toBe("acevolleyball");
  });

  it("strips a leading @", () => {
    expect(parseSocialHandle("facebook", "@acevolleyball")).toBe("acevolleyball");
  });

  it("strips an instagram.com URL, with or without scheme/www", () => {
    expect(parseSocialHandle("instagram", "instagram.com/acevolleyball")).toBe("acevolleyball");
    expect(parseSocialHandle("instagram", "https://www.instagram.com/acevolleyball/")).toBe(
      "acevolleyball"
    );
  });

  it("strips a facebook.com URL, with or without scheme/www", () => {
    expect(parseSocialHandle("facebook", "facebook.com/acevolleyball")).toBe("acevolleyball");
    expect(parseSocialHandle("facebook", "https://www.facebook.com/acevolleyball/")).toBe(
      "acevolleyball"
    );
  });

  it("strips a twitter.com or x.com URL, with or without scheme/www", () => {
    expect(parseSocialHandle("twitter", "twitter.com/acevolleyball")).toBe("acevolleyball");
    expect(parseSocialHandle("twitter", "https://x.com/acevolleyball")).toBe("acevolleyball");
    expect(parseSocialHandle("twitter", "https://www.x.com/acevolleyball/")).toBe(
      "acevolleyball"
    );
  });

  it("trims whitespace around a plain handle", () => {
    expect(parseSocialHandle("instagram", "  acevolleyball  ")).toBe("acevolleyball");
  });
});

describe("buildSocialUrl", () => {
  it("builds an instagram.com link", () => {
    expect(buildSocialUrl("instagram", "acevolleyball")).toBe(
      "https://instagram.com/acevolleyball"
    );
  });

  it("builds a facebook.com link", () => {
    expect(buildSocialUrl("facebook", "acevolleyball")).toBe(
      "https://facebook.com/acevolleyball"
    );
  });

  it("builds an x.com link, not twitter.com", () => {
    expect(buildSocialUrl("twitter", "acevolleyball")).toBe("https://x.com/acevolleyball");
  });
});
