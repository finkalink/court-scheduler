import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EventTypeBadge from "./EventTypeBadge";

describe("EventTypeBadge", () => {
  it("renders the human-readable label for the event type", () => {
    render(<EventTypeBadge eventType="open_play" />);
    expect(screen.getByText("Open Play")).toBeInTheDocument();
  });

  it("applies the status pill styling", () => {
    render(<EventTypeBadge eventType="tournament" />);
    const badge = screen.getByText("Tournament");
    expect(badge.className).toContain("bg-status");
    expect(badge.className).toContain("text-status-fg");
    expect(badge.className).toContain("rounded-full");
  });
});
