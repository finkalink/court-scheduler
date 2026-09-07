# Theme System Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design-token foundation (sand/teal light, charcoal/blue dark) and a persisted, no-flash, no-reload light/dark toggle in the sidebar, applied end to end to `AppShell` only.

**Architecture:** A single `theme` cookie is the one source of truth, read server-side in `layout.tsx` (sets `data-theme` on `<html>` before first paint — no flash) and mirrored by a client `ThemeToggle` component (instant DOM attribute flip on click, no page reload, cookie rewritten so the next server render agrees). CSS custom properties in `globals.css` define both palettes and alias into Tailwind's `@theme inline` so components can use plain utilities (`bg-card`, `text-fg`, etc.).

**Tech Stack:** Next.js 16 (App Router, `next/headers` cookies), React 19, Tailwind CSS v4 (`@theme inline`), Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-07-theme-system-phase1-design.md](../specs/2026-09-07-theme-system-phase1-design.md)

## Global Constraints

- One source of truth: the `theme` cookie. No `localStorage`. Never let a component write to one without the other going out of sync — there is only one thing to write.
- Merely *viewing* the page (system preference resolved client-side when no cookie exists) must never write a cookie or otherwise persist a choice — only an explicit click does.
- This phase touches exactly `src/lib/theme.ts`, `src/components/ThemeToggle.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, `src/components/AppShell.tsx`, plus each new file's test. No other file changes — the ~30 files still using ad-hoc `dark:` pairs are explicitly out of scope (Phase 2).
- Exact hex values are given in every task below, copied from the spec — use them verbatim, do not approximate or adjust for personal taste.

---

## File Structure

```
src/lib/theme.ts                     -- NEW: Theme type, THEME_COOKIE_NAME, isValidTheme
src/lib/theme.test.ts                -- NEW
src/components/ThemeToggle.tsx       -- NEW: the switch, client component
src/components/ThemeToggle.test.tsx  -- NEW
src/app/globals.css                  -- MODIFY: full token rewrite
src/app/layout.tsx                   -- MODIFY: read cookie, set data-theme, pass initialTheme down
src/components/AppShell.tsx          -- MODIFY: render ThemeToggle, re-theme onto new tokens
```

---

### Task 1: `isValidTheme`

**Files:**
- Create: `src/lib/theme.ts`
- Test: `src/lib/theme.test.ts`

**Interfaces:**
- Produces: `Theme` (type, `"light" | "dark"`), `THEME_COOKIE_NAME` (`"theme"`), `isValidTheme(value: string | undefined): value is Theme` — consumed by Task 2 (`ThemeToggle`) and Task 4 (`layout.tsx`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/theme.test.ts
import { describe, expect, it } from "vitest";
import { isValidTheme } from "@/lib/theme";

describe("isValidTheme", () => {
  it("accepts 'light'", () => {
    expect(isValidTheme("light")).toBe(true);
  });

  it("accepts 'dark'", () => {
    expect(isValidTheme("dark")).toBe(true);
  });

  it("rejects an unrecognized value", () => {
    expect(isValidTheme("blue")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidTheme(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/theme.ts
export type Theme = "light" | "dark";

export const THEME_COOKIE_NAME = "theme";

export function isValidTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "Add Theme type and isValidTheme"
```

---

### Task 2: `ThemeToggle`

**Files:**
- Create: `src/components/ThemeToggle.tsx`
- Test: `src/components/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `Theme`, `THEME_COOKIE_NAME` from `@/lib/theme` (Task 1).
- Produces: default-exported `ThemeToggle` component, props `{ initialTheme: Theme | null }` — consumed by Task 5 (`AppShell`).

- [ ] **Step 1: Write the failing tests**

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: FAIL — `Cannot find module './ThemeToggle'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/ThemeToggle.tsx
"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, type Theme } from "@/lib/theme";

export default function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const [theme, setTheme] = useState<Theme>(initialTheme ?? "light");

  useEffect(() => {
    if (initialTheme) return; // server already resolved an explicit choice -- trust it
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }, [initialTheme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE_NAME}=${next}; max-age=31536000; path=/; samesite=lax`;
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Toggle dark mode"
      onClick={toggle}
      className="flex items-center gap-2 text-xs text-fg-muted"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${
          theme === "dark" ? "bg-accent" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            theme === "dark" ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`bg-card`, `bg-accent` etc. used here are plain strings to Tailwind/TypeScript at this point — the classes not yet having matching CSS defined, from Task 3 not having landed yet, causes no compile or test failure, only a visual gap if manually checked before Task 3 — not a blocker for this task.)

- [ ] **Step 6: Commit**

```bash
git add src/components/ThemeToggle.tsx src/components/ThemeToggle.test.tsx
git commit -m "Add ThemeToggle"
```

---

### Task 3: `globals.css` token rewrite

**Files:**
- Modify: `src/app/globals.css` (full replacement)

**Interfaces:**
- Produces: CSS custom properties (`--surface`, `--card`, `--active`, `--border`, `--fg`, `--fg-muted`, `--accent`, `--accent-hover`, `--accent-fg`, `--link`, `--status`, `--status-fg`) and their Tailwind aliases (`--color-surface`, `--color-card`, etc., enabling `bg-surface`, `bg-card`, `border-border`, `text-fg`, `text-fg-muted`, `bg-accent`, `bg-accent-hover`, `text-accent-fg`, `text-link`, `bg-status`, `text-status-fg` utilities) — consumed by Task 2's `ThemeToggle` (already written, now gets real colors) and Task 5's `AppShell`.

- [ ] **Step 1: Replace the file**

```css
/* src/app/globals.css */
@import "tailwindcss";

:root {
  --surface: #F5F1E8;
  --card: #FFFDF8;
  --active: #EFE8D8;
  --border: #E8DFC9;
  --fg: #2B2418;
  --fg-muted: #7A6F58;
  --accent: #0F7A6B;
  --accent-hover: #0C6255;
  --accent-fg: #FFFFFF;
  --link: #0F7A6B;
  --status: #F5E4D0;
  --status-fg: #8A5322;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #15171C;
    --card: #1E2128;
    --active: #262A32;
    --border: #2C3038;
    --fg: #F2F3F5;
    --fg-muted: #9AA0AC;
    --accent: #2B6FE0;
    --accent-hover: #3D7EF0;
    --accent-fg: #FFFFFF;
    --link: #4E9BFF;
    --status: #3D2E12;
    --status-fg: #FFB25E;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --surface: #15171C;
  --card: #1E2128;
  --active: #262A32;
  --border: #2C3038;
  --fg: #F2F3F5;
  --fg-muted: #9AA0AC;
  --accent: #2B6FE0;
  --accent-hover: #3D7EF0;
  --accent-fg: #FFFFFF;
  --link: #4E9BFF;
  --status: #3D2E12;
  --status-fg: #FFB25E;
  color-scheme: dark;
}

@theme inline {
  --color-surface: var(--surface);
  --color-card: var(--card);
  --color-active: var(--active);
  --color-border: var(--border);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-link: var(--link);
  --color-status: var(--status);
  --color-status-fg: var(--status-fg);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--surface);
  color: var(--fg);
}
```

This is a full replacement of the file's current content (today it only has `--background`/`--foreground` plus a bare `@media` block and a `font-family: Arial, Helvetica, sans-serif;` line on `body` — that line is dropped here since `--font-sans` already resolves to the real Geist font already loaded by `layout.tsx`, matching what `@theme inline` already aliased before this change, just previously unused by the plain `body` rule).

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass (CSS changes don't affect TS/test compilation).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "Rewrite globals.css with the sand/teal and charcoal/blue token palettes"
```

---

### Task 4: Wire the cookie into `layout.tsx`

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `isValidTheme` from `@/lib/theme` (Task 1); `cookies` from `next/headers` (built-in).
- Produces: `initialTheme: Theme | null` passed as a new prop into `<AppShell>` — consumed by Task 5.

- [ ] **Step 1: Replace the file**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isValidTheme } from "@/lib/theme";
import AppShell from "@/components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Court Scheduler",
  description: "Book open court time slots",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const initialTheme = isValidTheme(themeCookie) ? themeCookie : null;

  return (
    <html
      lang="en"
      data-theme={initialTheme ?? undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell userEmail={user?.email ?? null} isOrgMember={!!membership} initialTheme={initialTheme}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
```

This will produce a type error until Task 5 gives `AppShell` an `initialTheme` prop — that's expected, resolved by the next task, matching this codebase's established pattern of an interim expected type error between two tightly-coupled tasks in the same plan.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly one error, at `layout.tsx`'s `<AppShell ... initialTheme={initialTheme}>` call site (`AppShell` doesn't accept that prop yet). Confirm it's the only error before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "Read theme cookie in layout.tsx and set data-theme on html"
```

---

### Task 5: Wire `ThemeToggle` into `AppShell` and re-theme it

**Files:**
- Modify: `src/components/AppShell.tsx` (full replacement)

**Interfaces:**
- Consumes: `ThemeToggle` (Task 2); `Theme` type from `@/lib/theme` (Task 1); the token-backed Tailwind utilities from Task 3 (`bg-card`, `border-border`, `text-fg`, `text-fg-muted`, `bg-active`, `text-link`).
- Produces: `AppShell` now accepts `initialTheme: Theme | null`, resolving Task 4's interim type error.

- [ ] **Step 1: Replace the file**

```tsx
// src/components/AppShell.tsx
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
```

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass (including the interim error from Task 4, now resolved).

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "Wire ThemeToggle into AppShell and re-theme it onto the new tokens"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Live verification**

Start the dev server (`npm run dev`) and, in a real browser:

1. Fresh profile / a private window with no `theme` cookie: confirm the sidebar matches the OS dark-mode setting on first load, with no visible flash of the wrong theme, and the toggle's displayed label/position matches it.
2. Click the toggle: confirm an instant repaint (no page navigation/reload) to the correct colors, and the label ("Light"/"Dark") and switch position update.
3. Refresh the page after toggling: confirm the explicit choice persisted (the server-rendered page opens already in the chosen theme, not system preference).
4. With an explicit cookie set, change the OS-level light/dark setting: confirm the app does **not** follow it — the explicit choice wins.
5. Resize to a mobile viewport, open the slide-over drawer: confirm the toggle is present and behaves identically.
6. Spot-check a few other pages (e.g. `/`, `/admin`, `/bookings`) to confirm they still render correctly and are visually unaffected by this phase (still following system preference via their existing, untouched `dark:` classes) — this phase must not have broken anything outside `AppShell`.

- [ ] **Step 2: Update STATUS.md**

Follow this project's established format — summarize the token system, the toggle mechanism (cookie-based, no flash, no reload), and that this is Phase 1 of 2 (the ~30-file sweep onto these tokens is separate, future work). Reference the spec and this plan by path.

- [ ] **Step 3: Commit and push**

```bash
git add docs/STATUS.md
git commit -m "Document theme system Phase 1 in STATUS.md"
git push
```

---

## Self-Review Notes

- **Spec coverage:** token palette (Task 3), cookie mechanism + no-flash SSR read (Task 4), toggle component + persistence + system-preference correction (Task 2), `AppShell` re-theme + toggle placement (Task 5) — every spec section maps to a task.
- **Placeholder scan:** none found — every task has complete, real code.
- **Type consistency:** `Theme` (Task 1) is the one type used everywhere; `ThemeToggle`'s `initialTheme` prop (Task 2) matches exactly what `layout.tsx` (Task 4) computes and what `AppShell` (Task 5) forwards; Tailwind utility names introduced in Task 3 (`bg-card`, `border-border`, `text-fg`, `text-fg-muted`, `bg-active`, `text-link`, `bg-accent`, `bg-accent-hover`, `text-accent-fg`) are exactly the set consumed across Tasks 2 and 5, no unused or missing tokens.
