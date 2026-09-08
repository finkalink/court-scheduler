# Open Court Tokens & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Open Court palette, Barlow typography, and a top-nav `AppShell` (replacing the sidebar), reusing the existing theme-cookie/toggle mechanism unchanged.

**Architecture:** Rewrite the CSS custom properties in `globals.css` to the new palette (adding `--success`/`--success-bg`/`--success-fg`), swap `next/font/google` fonts from Geist to Barlow/Barlow Condensed, restructure `AppShell.tsx` from a sidebar into a sticky top nav with an accessible mobile dropdown and an admin sub-nav, and reclass `SuccessBanner` onto the new success tokens.

**Tech Stack:** Next.js (App Router), Tailwind CSS v4 (`@theme inline`), `next/font/google`, Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-07-open-court-retheme-design.md](../specs/2026-09-07-open-court-retheme-design.md)

## Global Constraints

- TDD: write the failing test first, then implement until it passes; run `npm test` after each task (CLAUDE.md).
- Barlow Condensed applies only via a `font-display` utility, used for headings/wordmark/section titles — never body text, buttons, or form labels (spec, "Typography").
- No changes to `src/lib/theme.ts`, the theme cookie mechanism, or `layout.tsx`'s no-flash server logic beyond the font import swap (spec, "Non-goals").
- No new admin functionality — the admin sub-nav only links to routes that exist today (spec, "Non-goals").
- Existing token *names* (`--surface`, `--card`, `--accent`, etc.) are preserved; only values change and new ones are added — no component elsewhere in the app references a token name that stops existing.

**Correction from spec:** the spec's admin sub-nav sketch says "Locations | Team | Events." There is no admin-wide Events index route today — `/admin` (`src/app/admin/page.tsx`) *is* the Locations index, `/admin/team` is Team, and event management is nested per-location (`/admin/locations/[locationId]/events`), with no top-level `/admin/events`. Per the "no new admin functionality" constraint, the sub-nav in this plan has two tabs, **Locations** (→ `/admin`) and **Team** (→ `/admin/team`), not three.

---

### Task 1: Open Court design tokens in `globals.css`

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: CSS custom properties consumed by every `bg-*`/`text-*`/`border-*` Tailwind utility already used across the app (`surface`, `card`, `active`, `border`, `fg`, `fg-muted`, `accent`, `accent-hover`, `accent-fg`, `link`, `status`, `status-fg`), plus new `success`, `success-bg`, `success-fg`, and a new `font-display` utility (Tailwind v4 auto-generates a `font-*` utility for every `--font-*` key under `@theme`).

This is a values-only change to an existing, already-tested mechanism (the three-block cascade and `@theme inline` wiring were proven in Phase 1) — no new logic, so no unit test, consistent with Phase 1's own precedent of not testing `globals.css` directly. Verified via Task 3's `AppShell` tests (which assert the new token *classes* are applied) and manual visual check.

- [ ] **Step 1: Replace `globals.css` with the new token values**

```css
@import "tailwindcss";

/* Redefines what "dark:" means everywhere in the app -- not just the new
   token-driven components -- so it respects the explicit theme cookie
   (data-theme) with the same fallback-to-system-preference cascade as our
   own custom properties below, instead of Tailwind's default of purely
   following prefers-color-scheme. Without this, a page/component that
   still uses plain dark: classes (everything outside AppShell, until
   Phase 2's token sweep) would ignore an explicit "Light" choice whenever
   the OS itself prefers dark -- e.g. dark:hover:bg-neutral-800 firing on
   hover with unreadable dark-on-light text, which is the exact bug this
   fixes. Two sibling rules = OR'd together: explicit dark always wins;
   otherwise system preference decides, unless the explicit choice is light. */
@custom-variant dark {
  @media (prefers-color-scheme: dark) {
    &:not(:where([data-theme="light"], [data-theme="light"] *)) {
      @slot;
    }
  }
  &:where([data-theme="dark"], [data-theme="dark"] *) {
    @slot;
  }
}

:root {
  --surface: #F8FAFC;
  --card: #FFFFFF;
  --active: #EFF4FB;
  --border: #E2E8F0;
  --fg: #1E293B;
  --fg-muted: #55647A;
  --accent: #F97316;
  --accent-hover: #EA6A0C;
  --accent-fg: #1E1006;
  --link: #3B82F6;
  --status: #FEF3E8;
  --status-fg: #C2540A;
  --success: #0F7A6B;
  --success-bg: #E6F5F2;
  --success-fg: #0B5D51;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #0B1220;
    --card: #121A2B;
    --active: #17233A;
    --border: #223049;
    --fg: #E7ECF6;
    --fg-muted: #93A2BD;
    --accent: #FB923C;
    --accent-hover: #FDBA74;
    --accent-fg: #1E1006;
    --link: #7CB2FB;
    --status: #2A1B0C;
    --status-fg: #FDBA74;
    --success: #2DD4BF;
    --success-bg: #10302B;
    --success-fg: #5EEAD4;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --surface: #0B1220;
  --card: #121A2B;
  --active: #17233A;
  --border: #223049;
  --fg: #E7ECF6;
  --fg-muted: #93A2BD;
  --accent: #FB923C;
  --accent-hover: #FDBA74;
  --accent-fg: #1E1006;
  --link: #7CB2FB;
  --status: #2A1B0C;
  --status-fg: #FDBA74;
  --success: #2DD4BF;
  --success-bg: #10302B;
  --success-fg: #5EEAD4;
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
  --color-success: var(--success);
  --color-success-bg: var(--success-bg);
  --color-success-fg: var(--success-fg);
  --font-sans: var(--font-barlow);
  --font-display: var(--font-barlow-condensed);
}

body {
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
}
```

Note: `--font-mono`/Geist Mono is dropped entirely — a repo-wide search
found no component using the `font-mono` utility, so there's nothing to
preserve, and Task 2 stops loading that font.

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "Replace theme tokens with the Open Court palette"
```

---

### Task 2: Swap Geist for Barlow/Barlow Condensed in `layout.tsx`

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `--font-sans`/`--font-display` mapping from Task 1's `globals.css`.
- Produces: `--font-barlow`/`--font-barlow-condensed` CSS variables that Task 1's `@theme inline` block references.

No unit test — a font-loader/server-component change, consistent with Phase 1's precedent of verifying `layout.tsx` manually rather than with a unit test. Verified by `npm run build` succeeding (catches an invalid Google Fonts family/weight combination immediately) and the manual check in Task 3.

- [ ] **Step 1: Replace the font import and setup block**

In `src/app/layout.tsx`, replace:

```ts
import { Geist, Geist_Mono } from "next/font/google";
```

```ts
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
```

with:

```ts
import { Barlow, Barlow_Condensed } from "next/font/google";
```

```ts
const barlow = Barlow({
  variable: "--font-barlow",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
});
```

Then update the `<html>` `className`:

```tsx
className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
```

(replacing `${geistSans.variable} ${geistMono.variable}`).

- [ ] **Step 2: Run the build to catch a bad font config immediately**

Run: `npm run build`
Expected: succeeds with no font-loader error. (Barlow and Barlow Condensed are not variable fonts on Google Fonts, which is why `weight` is explicit here, unlike Geist — if the build complains about a missing/invalid weight, adjust the `weight` array to match what `next/font/google` reports as available for that family, then re-run.)

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "Load Barlow and Barlow Condensed instead of Geist"
```

---

### Task 3: Restructure `AppShell` into a top nav

**Files:**
- Modify: `src/components/AppShell.tsx`
- Test: `src/components/AppShell.test.tsx` (new)

**Interfaces:**
- Consumes: `ThemeToggle` (`src/components/ThemeToggle.tsx`, unchanged props: `initialTheme: Theme | null`), `signOut` (`src/app/actions/auth.ts`, unchanged), `Theme` type (`src/lib/theme.ts`, unchanged). Same `AppShell` props as today: `userEmail: string | null`, `isOrgMember: boolean`, `initialTheme: Theme | null`, `children: React.ReactNode`.
- Produces: no new exports consumed elsewhere — `AppShell` is the app's root layout wrapper, rendered once from `layout.tsx` with unchanged props, so no call site changes.

- [ ] **Step 1: Write the failing tests**

Create `src/components/AppShell.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: FAIL — `AppShell` still renders the old sidebar markup, so roles like `navigation` named `"Primary"` and `region` named `"Mobile menu"` don't exist yet.

- [ ] **Step 3: Replace `AppShell.tsx` with the top-nav implementation**

```tsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — confirms nothing else imports `AppShell` in a way that assumed the old sidebar markup (a repo search during planning found no other file references `AppShell`'s internals, only `layout.tsx` rendering it with props, which are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "Restructure AppShell from a sidebar into a top nav"
```

---

### Task 4: Reclass `SuccessBanner` onto the success tokens

**Files:**
- Modify: `src/components/SuccessBanner.tsx`
- Test: `src/components/SuccessBanner.test.tsx` (new)

**Interfaces:**
- Consumes: `--color-success-bg`/`--color-success-fg` Tailwind utilities from Task 1.
- Produces: no prop/signature change — still `{ children: React.ReactNode }`, so every call site (e.g. `src/app/admin/page.tsx`) is unaffected.

- [ ] **Step 1: Write the failing test**

Create `src/components/SuccessBanner.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SuccessBanner.test.tsx`
Expected: FAIL — current markup has `bg-green-50 ... dark:bg-green-950`, not `bg-success-bg`.

- [ ] **Step 3: Reclass the component**

```tsx
export default function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded bg-success-bg p-3 text-sm text-success-fg">
      {children}
    </p>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/SuccessBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SuccessBanner.tsx src/components/SuccessBanner.test.tsx
git commit -m "Reclass SuccessBanner onto the success tokens"
```

---

### Task 5: Manual verification

No new files — this task is the spec's "Manual verification plan," run once the above are in place.

- [ ] **Step 1:** Run `npm run dev` and open the app. Confirm the top nav, wordmark, and Barlow Condensed heading font render correctly on `/`.
- [ ] **Step 2:** Toggle dark mode from both the desktop account area and the mobile menu; confirm instant repaint and no flash on refresh (Phase 1 behavior unchanged).
- [ ] **Step 3:** Resize to 375px width; confirm the hamburger opens a full-width dropdown containing every link plus the theme toggle, and nothing is hidden behind the sticky header.
- [ ] **Step 4:** Sign in as an org admin and visit `/admin` and `/admin/team`; confirm the Locations/Team sub-nav appears and highlights the active tab, and disappears on non-admin routes.
- [ ] **Step 5:** Trigger a `SuccessBanner` (e.g. the admin location-added flow) in both light and dark mode; confirm it reads clearly with the new success tint.
- [ ] **Step 6:** Spot-check two or three pages *outside* `AppShell` (e.g. `/login`, `/bookings`) to confirm they still render — unchanged in this plan, still on their old raw `dark:` classes, to be swept in a follow-up plan.

---

## Self-Review

**Spec coverage:** Palette (Task 1) ✓. Typography/font swap (Task 2) ✓. Nav restructure — top nav, mobile dropdown, admin sub-nav, account-area theme toggle (Task 3) ✓. `SuccessBanner` reclass (Task 4) ✓. Manual verification plan from the spec (Task 5) ✓. The 33-file token sweep is explicitly **out of scope for this plan** — it becomes its own follow-up plan(s), per the batches already defined in the spec, once this foundation lands and is verified.

**Placeholder scan:** No TBDs; every step has runnable code or an exact command.

**Type consistency:** `AppShell` keeps its exact existing prop signature (`userEmail`, `isOrgMember`, `initialTheme`, `children`) so `layout.tsx` needs no changes beyond Task 2's font swap. `ThemeToggle`, `signOut`, and `Theme` are consumed with their current, unchanged signatures. `SuccessBanner` keeps its `{ children: React.ReactNode }` signature.
