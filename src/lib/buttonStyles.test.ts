import { describe, expect, it } from "vitest";
import { buttonClass } from "./buttonStyles";

describe("buttonClass", () => {
  it("returns accent styling for the primary variant", () => {
    const cls = buttonClass("primary");
    expect(cls).toContain("bg-accent");
    expect(cls).toContain("text-accent-fg");
  });

  it("returns bordered neutral styling for the secondary variant", () => {
    const cls = buttonClass("secondary");
    expect(cls).toContain("border-border");
    expect(cls).not.toContain("bg-accent");
  });

  it("returns a disabled, non-interactive style for either variant when disabled", () => {
    const cls = buttonClass("primary", { disabled: true });
    expect(cls).toContain("cursor-not-allowed");
    expect(cls).toContain("bg-active");
    expect(cls).not.toContain("bg-accent");
  });
});
