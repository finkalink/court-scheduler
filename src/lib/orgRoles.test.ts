import { describe, expect, it } from "vitest";
import { isOwnerOrAdmin, wouldRemoveLastOwner } from "@/lib/orgRoles";

describe("isOwnerOrAdmin", () => {
  it("is true for owner and admin, false for staff", () => {
    expect(isOwnerOrAdmin("owner")).toBe(true);
    expect(isOwnerOrAdmin("admin")).toBe(true);
    expect(isOwnerOrAdmin("staff")).toBe(false);
  });
});

describe("wouldRemoveLastOwner", () => {
  it("never blocks when the target isn't currently an owner", () => {
    expect(wouldRemoveLastOwner(1, "admin")).toBe(false);
    expect(wouldRemoveLastOwner(0, "staff")).toBe(false);
  });

  it("blocks when the target is the sole owner", () => {
    expect(wouldRemoveLastOwner(1, "owner")).toBe(true);
  });

  it("does not block when there are other owners", () => {
    expect(wouldRemoveLastOwner(2, "owner")).toBe(false);
    expect(wouldRemoveLastOwner(5, "owner")).toBe(false);
  });

  it("treats an owner count of zero as still blocking (defensive)", () => {
    expect(wouldRemoveLastOwner(0, "owner")).toBe(true);
  });
});
