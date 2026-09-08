"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import ThemeToggle from "@/components/ThemeToggle";
import type { Theme } from "@/lib/theme";

export default function AppShell({
  userEmail,
  isOrgMember,
  initialTheme,
  children,
}: {
  userEmail: string | null;
  isOrgMember: boolean;
  initialTheme: Theme | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  const findCourtActive =
    pathname === "/" ||
    pathname.startsWith("/locations") ||
    pathname.startsWith("/cities") ||
    pathname.startsWith("/clubs");
  const myEventsActive = pathname.startsWith("/events/registrations");
  const eventsActive = pathname.startsWith("/events") && !myEventsActive;
  const bookingsActive = pathname.startsWith("/bookings");
  const adminActive = pathname.startsWith("/admin");
  const profileActive = pathname.startsWith("/profile");
  const adminLocationsActive = pathname === "/admin" || pathname.startsWith("/admin/locations");
  const adminTeamActive = pathname.startsWith("/admin/team");

  const closeMenu = () => setMenuOpen(false);

  const navLinkClass = (active: boolean) =>
    `text-sm font-semibold ${active ? "text-fg" : "text-fg-muted hover:text-fg"}`;

  const mobileLinkClass = (active: boolean) =>
    `block rounded px-3 py-2 text-sm ${
      active ? "bg-active font-medium text-fg" : "text-fg-muted hover:bg-active"
    }`;

  const subNavLinkClass = (active: boolean) =>
    `text-xs font-semibold uppercase tracking-wide ${
      active ? "text-accent" : "text-fg-muted hover:text-fg"
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="font-display text-lg uppercase tracking-wide text-fg"
            onClick={closeMenu}
          >
            Court Scheduler<span className="text-accent">.</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
            <Link href="/" className={navLinkClass(findCourtActive)}>
              Find a Court
            </Link>
            <Link href="/events" className={navLinkClass(eventsActive)}>
              Events
            </Link>
            {userEmail && (
              <Link href="/bookings" className={navLinkClass(bookingsActive)}>
                My Bookings
              </Link>
            )}
            {userEmail && (
              <Link href="/events/registrations" className={navLinkClass(myEventsActive)}>
                My Events
              </Link>
            )}
            {userEmail && (
              <Link href="/profile" className={navLinkClass(profileActive)}>
                Profile
              </Link>
            )}
            {isOrgMember && (
              <Link href="/admin" className={navLinkClass(adminActive)}>
                Admin Dashboard
              </Link>
            )}
          </nav>

          <div className="hidden items-center gap-4 sm:flex">
            <ThemeToggle initialTheme={initialTheme} />
            {userEmail ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="max-w-[12rem] truncate text-fg-muted">{userEmail}</span>
                <form action={signOut}>
                  <button type="submit" className="text-link underline">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <Link href="/login" className="text-link underline">
                  Sign In
                </Link>
                <Link href="/signup" className="text-link underline">
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            className="text-xl leading-none text-fg sm:hidden"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {isOrgMember && adminActive && (
          <div className="hidden border-t border-border px-4 py-2 sm:flex sm:gap-5 sm:px-6">
            <Link href="/admin" className={subNavLinkClass(adminLocationsActive)}>
              Locations
            </Link>
            <Link href="/admin/team" className={subNavLinkClass(adminTeamActive)}>
              Team
            </Link>
          </div>
        )}

        {menuOpen && (
          <div role="region" aria-label="Mobile menu" className="border-t border-border px-2 py-2 sm:hidden">
            <Link href="/" className={mobileLinkClass(findCourtActive)} onClick={closeMenu}>
              Find a Court
            </Link>
            <Link href="/events" className={mobileLinkClass(eventsActive)} onClick={closeMenu}>
              Events
            </Link>
            {userEmail && (
              <Link href="/bookings" className={mobileLinkClass(bookingsActive)} onClick={closeMenu}>
                My Bookings
              </Link>
            )}
            {userEmail && (
              <Link
                href="/events/registrations"
                className={mobileLinkClass(myEventsActive)}
                onClick={closeMenu}
              >
                My Events
              </Link>
            )}
            {userEmail && (
              <Link href="/profile" className={mobileLinkClass(profileActive)} onClick={closeMenu}>
                Profile
              </Link>
            )}
            {isOrgMember && (
              <>
                <div className="my-2 border-t border-border" />
                <Link
                  href="/admin"
                  className={mobileLinkClass(adminLocationsActive)}
                  onClick={closeMenu}
                >
                  Admin: Locations
                </Link>
                <Link
                  href="/admin/team"
                  className={mobileLinkClass(adminTeamActive)}
                  onClick={closeMenu}
                >
                  Admin: Team
                </Link>
              </>
            )}
            <div className="my-2 border-t border-border" />
            <div className="px-3 py-2">
              <ThemeToggle initialTheme={initialTheme} />
            </div>
            {userEmail ? (
              <div className="flex flex-col gap-2 px-3 py-2 text-sm">
                <span className="truncate text-fg-muted">{userEmail}</span>
                <form action={signOut}>
                  <button type="submit" className="text-left text-link underline">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-3 py-2 text-sm">
                <Link href="/login" className="text-link underline" onClick={closeMenu}>
                  Sign In
                </Link>
                <Link href="/signup" className="text-link underline" onClick={closeMenu}>
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        )}
      </header>

      <div>{children}</div>
    </div>
  );
}
