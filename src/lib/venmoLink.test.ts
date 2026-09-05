import { describe, expect, it } from "vitest";
import { buildVenmoPaymentUrl } from "@/lib/venmoLink";

describe("buildVenmoPaymentUrl", () => {
  it("builds a pay link with handle, amount, and note", () => {
    const url = buildVenmoPaymentUrl({
      handle: "ace-volleyball",
      amountCents: 2500,
      note: "Fall Open Tournament",
    });
    expect(url).toBe(
      "https://venmo.com/?txn=pay&recipients=ace-volleyball&amount=25.00&note=Fall+Open+Tournament"
    );
  });

  it("formats a non-whole-dollar amount to two decimal places", () => {
    const url = buildVenmoPaymentUrl({ handle: "ace-volleyball", amountCents: 1050, note: "x" });
    expect(url).toContain("amount=10.50");
  });

  it("URL-encodes special characters in the note", () => {
    const url = buildVenmoPaymentUrl({
      handle: "ace-volleyball",
      amountCents: 100,
      note: "Jane's Team — Fall",
    });
    const params = new URL(url).searchParams;
    expect(params.get("note")).toBe("Jane's Team — Fall");
  });
});
