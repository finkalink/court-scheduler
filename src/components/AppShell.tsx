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
  const [open, setOpen] = useState(false);
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

  const linkClass = (active: boolean) =>
    `block rounded px-3 py-2 text-sm ${
      active ? "bg-active font-medium" : "text-fg-muted hover:bg-active"
    }`;

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 text-fg sm:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="text-xl leading-none"
        >
          &#9776;
        </button>
        <span className="font-semibold">Court Scheduler</span>
        <span className="w-6" />
      </div>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 sm:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card text-fg transition-transform sm:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 sm:py-4">
          <Link href="/" className="font-semibold" onClick={() => setOpen(false)}>
            Court Scheduler
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="text-lg leading-none sm:hidden"
          >
            &#10005;
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2">
          <Link href="/" className={linkClass(findCourtActive)} onClick={() => setOpen(false)}>
            Find a Court
          </Link>
          <Link href="/events" className={linkClass(eventsActive)} onClick={() => setOpen(false)}>
            Events
          </Link>
          {userEmail && (
            <Link
              href="/bookings"
              className={linkClass(bookingsActive)}
              onClick={() => setOpen(false)}
            >
              My Bookings
            </Link>
          )}
          {userEmail && (
            <Link
              href="/events/registrations"
              className={linkClass(myEventsActive)}
              onClick={() => setOpen(false)}
            >
              My Events
            </Link>
          )}
          {userEmail && (
            <Link
              href="/profile"
              className={linkClass(profileActive)}
              onClick={() => setOpen(false)}
            >
              Profile
            </Link>
          )}
          {isOrgMember && (
            <>
              <div className="my-2 border-t border-border" />
              <Link
                href="/admin"
                className={linkClass(adminActive)}
                onClick={() => setOpen(false)}
              >
                Admin Dashboard
              </Link>
            </>
          )}
        </nav>

        <div className="border-t border-border px-4 py-3 text-sm">
          <div className="mb-3">
            <ThemeToggle initialTheme={initialTheme} />
          </div>
          {userEmail ? (
            <div className="flex flex-col gap-2">
              <span className="truncate text-fg-muted">{userEmail}</span>
              <form action={signOut}>
                <button type="submit" className="text-left text-link underline">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Link href="/login" className="text-link underline" onClick={() => setOpen(false)}>
                Sign In
              </Link>
              <Link href="/signup" className="text-link underline" onClick={() => setOpen(false)}>
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </aside>

      <div className="sm:pl-64">{children}</div>
    </div>
  );
}
