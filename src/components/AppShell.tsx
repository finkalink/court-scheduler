"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";

export default function AppShell({
  userEmail,
  isOrgMember,
  children,
}: {
  userEmail: string | null;
  isOrgMember: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const findCourtActive =
    pathname === "/" ||
    pathname.startsWith("/locations") ||
    pathname.startsWith("/cities") ||
    pathname.startsWith("/clubs");
  const bookingsActive = pathname.startsWith("/bookings");
  const adminActive = pathname.startsWith("/admin");

  const linkClass = (active: boolean) =>
    `block rounded px-3 py-2 text-sm ${
      active
        ? "bg-gray-100 font-medium dark:bg-neutral-800"
        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
    }`;

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b bg-white px-4 py-3 text-gray-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-100 sm:hidden">
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-white text-gray-900 transition-transform dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-100 sm:translate-x-0 ${
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
          {userEmail && (
            <Link
              href="/bookings"
              className={linkClass(bookingsActive)}
              onClick={() => setOpen(false)}
            >
              My Bookings
            </Link>
          )}
          {isOrgMember && (
            <>
              <div className="my-2 border-t dark:border-neutral-800" />
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

        <div className="border-t px-4 py-3 text-sm dark:border-neutral-800">
          {userEmail ? (
            <div className="flex flex-col gap-2">
              <span className="truncate text-gray-600 dark:text-gray-400">{userEmail}</span>
              <form action={signOut}>
                <button type="submit" className="text-left underline">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Link href="/login" className="underline" onClick={() => setOpen(false)}>
                Sign In
              </Link>
              <Link href="/signup" className="underline" onClick={() => setOpen(false)}>
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
