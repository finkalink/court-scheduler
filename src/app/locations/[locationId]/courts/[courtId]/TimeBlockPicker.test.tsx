import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TimeBlockPicker from "./TimeBlockPicker";
import type { Slot } from "@/lib/availability";

const slots: Slot[] = [
  { start: "2026-09-08T13:00:00.000Z", end: "2026-09-08T14:00:00.000Z" }, // 9:00 AM America/New_York
  { start: "2026-09-08T14:00:00.000Z", end: "2026-09-08T15:00:00.000Z" }, // 10:00 AM America/New_York
];

describe("TimeBlockPicker", () => {
  it("renders a button for each slot", () => {
    render(<TimeBlockPicker slots={slots} timezone="America/New_York" courtHref="/x" date="2026-09-08" />);
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
  });

  it("styles a selected slot with the primary accent classes, not black", () => {
    render(<TimeBlockPicker slots={slots} timezone="America/New_York" courtHref="/x" date="2026-09-08" />);
    const button = screen.getByText("9:00 AM");
    fireEvent.click(button);
    expect(button.className).toContain("bg-accent");
    expect(button.className).not.toContain("bg-black");
  });

  it("does not use bg-black for the enabled Continue link", () => {
    render(<TimeBlockPicker slots={slots} timezone="America/New_York" courtHref="/x" date="2026-09-08" />);
    fireEvent.click(screen.getByText("9:00 AM"));
    const continueLink = screen.getByText("Continue");
    expect(continueLink.className).not.toContain("bg-black");
  });
});
