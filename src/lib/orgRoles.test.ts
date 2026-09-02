import { describe, expect, it } from "vitest";
import { canActOnMember, isOwnerOrAdmin, wouldRemoveLastOwner } from "@/lib/orgRoles";

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

describe("canActOnMember", () => {
  it("blocks a non-owner admin from acting on an owner", () => {
    expect(canActOnMember("admin", "owner")).toBe(false);
    expect(canActOnMember("staff", "owner")).toBe(false);
  });

  it("allows an owner to act on another owner", () => {
    expect(canActOnMember("owner", "owner")).toBe(true);
  });

  it("allows any org admin/owner to act on a non-owner target", () => {
    expect(canActOnMember("admin", "admin")).toBe(true);
    expect(canActOnMember("admin", "staff")).toBe(true);
    expect(canActOnMember("owner", "staff")).toBe(true);
  });
});
