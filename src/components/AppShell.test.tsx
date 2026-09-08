// src/components/AppShell.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AppShell from "./AppShell";

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

beforeEach(() => {
  mockUsePathname.mockReturnValue("/");
});

describe("AppShell", () => {
  it("always shows Find a Court and Events in the primary nav", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByRole("link", { name: "Find a Court" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("link", { name: "Events" })).toBeInTheDocument();
  });

  it("hides account-only links when signed out", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).queryByRole("link", { name: "My Bookings" })).not.toBeInTheDocument();
    expect(within(primaryNav).queryByRole("link", { name: "My Events" })).not.toBeInTheDocument();
    expect(within(primaryNav).queryByRole("link", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign Up" })).toBeInTheDocument();
  });

  it("shows account-only links and a sign-out form when signed in", () => {
    render(
      <AppShell userEmail="player@example.com" isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByRole("link", { name: "My Bookings" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("link", { name: "My Events" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("player@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the admin sub-nav only for org members on an admin route", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.getByRole("link", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("does not show the admin sub-nav for org members off an admin route", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });

  it("does not show Admin Dashboard or the sub-nav for non-members", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(
      <AppShell userEmail="player@example.com" isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("link", { name: "Admin Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument();
  });

  it("opens and closes the mobile menu", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("region", { name: "Mobile menu" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("region", { name: "Mobile menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("region", { name: "Mobile menu" })).not.toBeInTheDocument();
  });

  it("mirrors the primary links and the theme toggle inside the mobile menu", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} initialTheme="light">
        <div />
      </AppShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileMenu = screen.getByRole("region", { name: "Mobile menu" });
    expect(within(mobileMenu).getByRole("link", { name: "Find a Court" })).toBeInTheDocument();
    expect(within(mobileMenu).getByRole("switch")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} initialTheme="light">
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
