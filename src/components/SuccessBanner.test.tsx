// src/components/SuccessBanner.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SuccessBanner from "./SuccessBanner";

describe("SuccessBanner", () => {
  it("renders its children with the success tokens applied", () => {
    render(<SuccessBanner>Booking confirmed</SuccessBanner>);
    const banner = screen.getByText("Booking confirmed");
    expect(banner).toHaveClass("bg-success-bg", "text-success-fg");
  });
});
