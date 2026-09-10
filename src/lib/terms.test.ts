import { describe, expect, it } from "vitest";
import { CURRENT_TOS_VERSION, hasAcceptedCurrentTerms } from "./terms";

describe("hasAcceptedCurrentTerms", () => {
  it("returns true when the stored version matches the current version", () => {
    expect(hasAcceptedCurrentTerms({ tos_accepted_version: CURRENT_TOS_VERSION })).toBe(true);
  });

  it("returns false when no version is stored", () => {
    expect(hasAcceptedCurrentTerms({ tos_accepted_version: null })).toBe(false);
  });

  it("returns false when the stored version is stale", () => {
    expect(hasAcceptedCurrentTerms({ tos_accepted_version: "2020-01-01" })).toBe(false);
  });
});
