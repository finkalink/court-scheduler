import { describe, expect, it } from "vitest";
import { isValidTheme } from "@/lib/theme";

describe("isValidTheme", () => {
  it("accepts 'light'", () => {
    expect(isValidTheme("light")).toBe(true);
  });

  it("accepts 'dark'", () => {
    expect(isValidTheme("dark")).toBe(true);
  });

  it("rejects an unrecognized value", () => {
    expect(isValidTheme("blue")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidTheme(undefined)).toBe(false);
  });
});
