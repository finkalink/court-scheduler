import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/money";

describe("formatCents", () => {
  it("formats whole dollars with two decimal places", () => {
    expect(formatCents(2500)).toBe("$25.00");
  });

  it("formats cents that aren't a whole dollar", () => {
    expect(formatCents(150)).toBe("$1.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });
});
