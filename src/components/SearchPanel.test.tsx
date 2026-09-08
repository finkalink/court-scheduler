// src/components/SearchPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchPanel from "./SearchPanel";

describe("SearchPanel", () => {
  it("always renders the city search form", () => {
    render(<SearchPanel isPlatformAdmin={false} onClose={() => {}} />);
    expect(screen.getByLabelText("Search cities")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("hides site-admin links for a non-platform-admin", () => {
    render(<SearchPanel isPlatformAdmin={false} onClose={() => {}} />);
    expect(screen.queryByText("Site admin: Organizations")).not.toBeInTheDocument();
  });

  it("shows site-admin links for a platform admin and calls onClose when one is clicked", () => {
    const onClose = vi.fn();
    render(<SearchPanel isPlatformAdmin={true} onClose={onClose} />);
    const link = screen.getByText("Site admin: Users");
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SearchPanel isPlatformAdmin={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the panel", () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <SearchPanel isPlatformAdmin={false} onClose={onClose} />
      </div>
    );
    fireEvent.click(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
