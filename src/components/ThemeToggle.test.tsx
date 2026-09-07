// src/components/ThemeToggle.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function clearThemeCookie() {
  document.cookie = "theme=; max-age=0; path=/";
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  clearThemeCookie();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  clearThemeCookie();
});

describe("ThemeToggle", () => {
  it("renders Light and aria-checked=false when initialTheme is light", () => {
    render(<ThemeToggle initialTheme="light" />);
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("renders Dark and aria-checked=true when initialTheme is dark", () => {
    render(<ThemeToggle initialTheme="dark" />);
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("clicking flips the label, aria-checked, and the html data-theme attribute", () => {
    render(<ThemeToggle initialTheme="light" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("clicking writes a theme cookie with the new value", () => {
    render(<ThemeToggle initialTheme="light" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(document.cookie).toContain("theme=dark");
  });

  it("with no initialTheme, corrects its displayed state to match system dark preference and writes no cookie", () => {
    mockMatchMedia(true);
    render(<ThemeToggle initialTheme={null} />);
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(document.cookie).not.toContain("theme=");
  });
});
