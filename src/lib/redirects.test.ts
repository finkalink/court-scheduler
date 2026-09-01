import { describe, expect, it } from "vitest";
import { isSafeRedirectPath } from "@/lib/redirects";

describe("isSafeRedirectPath", () => {
  it("accepts a valid same-origin relative path", () => {
    expect(isSafeRedirectPath("/events/abc123")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejects a protocol-relative path (//)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejects a backslash-normalization bypass (/\\)", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
  });

  it("rejects an absolute URL", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejects a bare domain with no leading slash", () => {
    expect(isSafeRedirectPath("evil.com")).toBe(false);
  });
});
