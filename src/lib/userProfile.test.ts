import { describe, expect, it } from "vitest";
import { isProfileComplete } from "@/lib/userProfile";

describe("isProfileComplete", () => {
  it("is true when all three fields are set", () => {
    expect(isProfileComplete({ name: "Alex", gender: "female", skill_level: "BB" })).toBe(true);
  });

  it("is false when name is missing", () => {
    expect(isProfileComplete({ name: null, gender: "female", skill_level: "BB" })).toBe(false);
  });

  it("is false when gender is missing", () => {
    expect(isProfileComplete({ name: "Alex", gender: null, skill_level: "BB" })).toBe(false);
  });

  it("is false when skill_level is missing", () => {
    expect(isProfileComplete({ name: "Alex", gender: "female", skill_level: null })).toBe(false);
  });

  it("treats an empty string the same as missing", () => {
    expect(isProfileComplete({ name: "", gender: "female", skill_level: "BB" })).toBe(false);
  });

  it("is false when everything is missing", () => {
    expect(isProfileComplete({ name: null, gender: null, skill_level: null })).toBe(false);
  });
});
