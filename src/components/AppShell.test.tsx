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
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByRole("link", { name: "Find a Court" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("link", { name: "Events" })).toBeInTheDocument();
  });

  it("hides account-only links when signed out", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
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
      <AppShell userEmail="player@example.com" isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
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

  it("shows Club admin (renamed from Admin Dashboard) only for org members", () => {
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByRole("link", { name: "Club admin" })).toBeInTheDocument();
  });

  it("shows the admin sub-nav only for org members on an admin route", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.getByRole("link", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("does not show the admin sub-nav for org members off an admin route", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });

  it("does not show Club admin or the sub-nav for non-members", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(
      <AppShell userEmail="player@example.com" isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("link", { name: "Club admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument();
  });

  it("shows Site admin and its sub-nav only for platform admins on a site-admin route", () => {
    mockUsePathname.mockReturnValue("/site-admin/orgs");
    render(
      <AppShell userEmail="owner@example.com" isOrgMember={false} isPlatformAdmin={true} initialTheme="light">
        <div />
      </AppShell>
    );
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByRole("link", { name: "Site admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("does not show Site admin or its sub-nav for a non-platform-admin", () => {
    mockUsePathname.mockReturnValue("/site-admin/orgs");
    render(
      <AppShell userEmail="player@example.com" isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("link", { name: "Site admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Organizations" })).not.toBeInTheDocument();
  });

  it("opens and closes the mobile menu", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
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
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileMenu = screen.getByRole("region", { name: "Mobile menu" });
    expect(within(mobileMenu).getByRole("link", { name: "Find a Court" })).toBeInTheDocument();
    expect(within(mobileMenu).getByRole("switch")).toBeInTheDocument();
  });

  it("shows unscoped admin links in the mobile menu for an org member on a non-admin route", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppShell userEmail="admin@example.com" isOrgMember={true} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileMenu = screen.getByRole("region", { name: "Mobile menu" });
    expect(within(mobileMenu).getByRole("link", { name: "Admin: Locations" })).toBeInTheDocument();
    expect(within(mobileMenu).getByRole("link", { name: "Admin: Team" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument();
  });

  it("shows unscoped site-admin links in the mobile menu for a platform admin on any route", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppShell userEmail="owner@example.com" isOrgMember={false} isPlatformAdmin={true} initialTheme="light">
        <div />
      </AppShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileMenu = screen.getByRole("region", { name: "Mobile menu" });
    expect(within(mobileMenu).getByRole("link", { name: "Site Admin: Organizations" })).toBeInTheDocument();
    expect(within(mobileMenu).getByRole("link", { name: "Site Admin: Users" })).toBeInTheDocument();
    expect(within(mobileMenu).getByRole("link", { name: "Site Admin: Settings" })).toBeInTheDocument();
  });

  it("opens the search panel when the search button is clicked", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div />
      </AppShell>
    );
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(screen.getByRole("region", { name: "Search" })).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
