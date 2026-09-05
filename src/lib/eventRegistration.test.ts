import { describe, expect, it } from "vitest";
import { determineRegistrationStatus, initialPaymentStatus } from "@/lib/eventRegistration";

describe("determineRegistrationStatus", () => {
  it("registers when capacity is unlimited (null)", () => {
    expect(determineRegistrationStatus(0, null)).toBe("registered");
    expect(determineRegistrationStatus(1000, null)).toBe("registered");
  });

  it("registers when under capacity", () => {
    expect(determineRegistrationStatus(3, 8)).toBe("registered");
  });

  it("registers on the last available spot", () => {
    expect(determineRegistrationStatus(7, 8)).toBe("registered");
  });

  it("waitlists once capacity is reached", () => {
    expect(determineRegistrationStatus(8, 8)).toBe("waitlisted");
  });

  it("waitlists when already over capacity", () => {
    expect(determineRegistrationStatus(10, 8)).toBe("waitlisted");
  });

  it("waitlists immediately when capacity is zero", () => {
    expect(determineRegistrationStatus(0, 0)).toBe("waitlisted");
  });
});

describe("initialPaymentStatus", () => {
  it("is not_required when there's no fee", () => {
    expect(initialPaymentStatus(null)).toBe("not_required");
    expect(initialPaymentStatus(0)).toBe("not_required");
  });

  it("is pending when there's a positive fee", () => {
    expect(initialPaymentStatus(2500)).toBe("pending");
  });
});
