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

  const findCourtActive = pathname === "/" || pathname.startsWith("/locations");
  const bookingsActive = pathname.startsWith("/bookings");
  const adminActive = pathname.startsWith("/admin");

  const linkClass = (active: boolean) =>
    `block rounded px-3 py-2 text-sm ${active ? "bg-gray-100 font-medium" : "text-gray-700 hover:bg-gray-50"}`;

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b bg-white px-4 py-3 text-gray-900 sm:hidden">
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-white text-gray-900 transition-transform sm:translate-x-0 ${
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
            Find a court
          </Link>
          {userEmail && (
            <Link
              href="/bookings"
              className={linkClass(bookingsActive)}
              onClick={() => setOpen(false)}
            >
              My bookings
            </Link>
          )}
          {isOrgMember && (
            <>
              <div className="my-2 border-t" />
              <Link
                href="/admin"
                className={linkClass(adminActive)}
                onClick={() => setOpen(false)}
              >
                Admin dashboard
              </Link>
            </>
          )}
        </nav>

        <div className="border-t px-4 py-3 text-sm">
          {userEmail ? (
            <div className="flex flex-col gap-2">
              <span className="truncate text-gray-600">{userEmail}</span>
              <form action={signOut}>
                <button type="submit" className="text-left underline">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Link href="/login" className="underline" onClick={() => setOpen(false)}>
                Sign in
              </Link>
              <Link href="/signup" className="underline" onClick={() => setOpen(false)}>
                Sign up
              </Link>
            </div>
          )}
        </div>
      </aside>

      <div className="sm:pl-64">{children}</div>
    </div>
  );
}
