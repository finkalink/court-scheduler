# Navigation Redesign + Platform Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top nav with role-aware navigation (player / club admin / new platform-wide site admin), add a click-to-open search panel (no hotkey), and ship the site-admin tier for real: a new `is_platform_admin` role backed by RLS, with working pages for organizations, users, and one site-wide setting.

**Architecture:** One new migration adds the role/deactivation columns and RLS policies. `AppShell` gains a third nav tier and a search panel. Three new `/site-admin/*` pages reuse the existing admin-page conventions (server component + form-posting server actions, RLS as the real enforcement layer).

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (Postgres/RLS), Tailwind CSS v4 token classes, Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-08-nav-redesign-platform-admin-design.md](../specs/2026-09-08-nav-redesign-platform-admin-design.md)

## Global Constraints

- No new npm dependencies.
- No Supabase Auth Admin API / service-role usage anywhere — deactivation is enforced entirely through RLS, matching every other permission check in this codebase.
- No keyboard shortcut for search — click/tap only.
- New files use the semantic token classes already established in `AppShell.tsx`/`AllCitiesContent.tsx`/`LandingPage.tsx` (`bg-card`, `border-border`, `text-fg`, `text-fg-muted`, `bg-accent`/`text-accent-fg`, `bg-status`/`text-status-fg`, `bg-active`, `text-link`) — never raw Tailwind gray/black classes, even though the older `src/app/admin/*` pages still use those. Do not touch those older admin pages as part of this plan.
- Run `npm test` after every task. Run `npx tsc --noEmit` after every task that touches `.tsx`/`.ts` files.
- If working in a worktree, copy `.env.local` in before running `npm run migrate` (it is gitignored and worktrees do not inherit it) — confirm it's still gitignored there before use.
- Bootstrap platform-admin email: `bdfink.su@gmail.com` (the project owner's account).

---

### Task 1: Migration — platform admin role, deactivation, site settings

**Files:**
- Create: `supabase/migrations/0032_platform_admin.sql`

**Interfaces:**
- Produces: columns `users.is_platform_admin`, `users.is_active`, `organizations.is_active`; functions `public.is_platform_admin()`, `public.is_current_user_active()`; table `site_settings(key, value, updated_at)`. Every later task's RLS-dependent behavior (site-admin pages working for a platform admin and being blocked for everyone else) relies on this migration being applied first.

- [ ] **Step 1: Write the migration**

```sql
-- Platform-wide admin role, independent of any org membership.
alter table users add column is_platform_admin boolean not null default false;

-- Lets a site admin hide a whole club from public browsing without
-- touching every location/court row underneath it.
alter table organizations add column is_active boolean not null default true;

-- Lets a site admin block a specific player from creating new
-- bookings/registrations without banning their auth account.
alter table users add column is_active boolean not null default true;

create function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_platform_admin from users where id = auth.uid()),
    false
  );
$$;

create function public.is_current_user_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_active from users where id = auth.uid()),
    true
  );
$$;

-- Platform admins get full cross-org access. Postgres OR-combines multiple
-- permissive policies per command, so these are additive to every existing
-- policy below -- nothing existing is dropped for this part.
create policy "organizations platform admin all" on organizations
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "org_members platform admin all" on org_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "users platform admin all" on users
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Public browsing must stop surfacing a deactivated org's locations, while
-- the org's own members (to manage/reactivate) and platform admins (to
-- review it) keep seeing it. This changes existing behavior, so the old
-- policy is dropped and replaced rather than added-to.
drop policy "locations select all" on locations;
create policy "locations select all" on locations
  for select using (
    auth.role() = 'authenticated'
    and (
      public.is_org_member(org_id)
      or public.is_platform_admin()
      or exists (
        select 1 from organizations o where o.id = locations.org_id and o.is_active
      )
    )
  );

-- A deactivated player can't create new bookings...
drop policy "bookings insert own" on bookings;
create policy "bookings insert own" on bookings
  for insert with check (user_id = auth.uid() and public.is_current_user_active());

-- ...or new individual event registrations. Admin-assembled (org member)
-- and team-captain paths are untouched -- deactivation blocks
-- self-service, not being placed on a team by an admin.
drop policy "event_registrations insert own or captain or member" on event_registrations;
create policy "event_registrations insert own or captain or member" on event_registrations
  for insert with check (
    (user_id = auth.uid() and public.is_current_user_active())
    or exists (
      select 1 from event_teams t
      where t.id = team_id and t.captain_user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  );

-- Site-wide settings: key/value so more rows can be added later without a
-- migration. Publicly readable (the banner must render for logged-out
-- visitors on the landing page); writable only by platform admins.
create table site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

create policy "site_settings select all" on site_settings
  for select using (true);
create policy "site_settings write platform admin" on site_settings
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- No explicit grant statements: every other plain table in this schema
-- (organizations, locations, ...) relies on Supabase's default
-- public-schema privileges plus RLS alone, with explicit grants reserved
-- for VIEWS (booked_slots, event_registration_counts) that bypass owner
-- privileges. site_settings is a plain table, so it follows that same
-- convention.

insert into site_settings (key, value) values ('announcement_banner', '');

-- Bootstrap: seed the project owner as the first (and for now, only)
-- platform admin.
update users set is_platform_admin = true where email = 'bdfink.su@gmail.com';
```

- [ ] **Step 2: Apply the migration to the live project**

Run: `npm run migrate supabase/migrations/0032_platform_admin.sql`
Expected: prints `Applied supabase/migrations/0032_platform_admin.sql` with no errors.

- [ ] **Step 3: Verify the bootstrap update took effect**

```bash
cat > verify-platform-admin.mjs <<'EOF'
import { Client } from "pg";
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select email, is_platform_admin from users where email = $1",
  ["bdfink.su@gmail.com"]
);
console.log(rows);
await client.end();
EOF
node --env-file=.env.local verify-platform-admin.mjs
rm verify-platform-admin.mjs
```

Expected: prints a single row with `is_platform_admin: true`. If it prints an empty array, stop — the account doesn't exist yet under that email in `public.users`, and later tasks' manual verification (as the bootstrap platform admin) won't be possible until that's resolved; report this rather than continuing silently.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (no app code changed yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0032_platform_admin.sql
git commit -m "Add platform admin role, org/user deactivation, and site settings"
```

---

### Task 2: `getIsPlatformAdmin` helper

**Files:**
- Create: `src/lib/platformAdmin.ts`
- Test: `src/lib/platformAdmin.test.ts`

**Interfaces:**
- Consumes: `users.is_platform_admin` (Task 1).
- Produces: `getIsPlatformAdmin(supabase: SupabaseClient, userId: string | undefined): Promise<boolean>` — used by Task 3 (`layout.tsx`) and every `/site-admin/*` page (Tasks 6-8).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/platformAdmin.test.ts
import { describe, it, expect } from "vitest";
import { getIsPlatformAdmin } from "./platformAdmin";

function mockSupabase(row: { is_platform_admin: boolean } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row }),
        }),
      }),
    }),
  } as any;
}

describe("getIsPlatformAdmin", () => {
  it("returns false when there is no signed-in user", async () => {
    const result = await getIsPlatformAdmin(mockSupabase(null), undefined);
    expect(result).toBe(false);
  });

  it("returns true when the user's row has is_platform_admin set", async () => {
    const result = await getIsPlatformAdmin(mockSupabase({ is_platform_admin: true }), "user-1");
    expect(result).toBe(true);
  });

  it("returns false when the user's row has is_platform_admin unset", async () => {
    const result = await getIsPlatformAdmin(mockSupabase({ is_platform_admin: false }), "user-1");
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/platformAdmin.test.ts`
Expected: FAIL — `Cannot find module './platformAdmin'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/platformAdmin.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getIsPlatformAdmin(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_platform_admin ?? false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/platformAdmin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/platformAdmin.ts src/lib/platformAdmin.test.ts
git commit -m "Add getIsPlatformAdmin helper"
```

---

### Task 3: AppShell nav tabs — Club admin rename, Site admin tab, pill sub-nav

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `getIsPlatformAdmin` (Task 2).
- Produces: `AppShell` gains a required `isPlatformAdmin: boolean` prop. Task 4 (search) edits this same file next, on top of what this task commits.

- [ ] **Step 1: Replace `AppShell.test.tsx` with the target content (write the failing tests)**

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

  it("renders children", () => {
    render(
      <AppShell userEmail={null} isOrgMember={false} isPlatformAdmin={false} initialTheme="light">
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: FAIL — "Club admin"/"Site admin" links and the site-admin sub-nav don't exist yet in the current `AppShell.tsx`.

- [ ] **Step 3: Replace `AppShell.tsx` with the target content**

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
  isPlatformAdmin,
  initialTheme,
  children,
}: {
  userEmail: string | null;
  isOrgMember: boolean;
  isPlatformAdmin: boolean;
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
  const siteAdminActive = pathname.startsWith("/site-admin");
  const siteAdminOrgsActive = pathname === "/site-admin" || pathname.startsWith("/site-admin/orgs");
  const siteAdminUsersActive = pathname.startsWith("/site-admin/users");
  const siteAdminSettingsActive = pathname.startsWith("/site-admin/settings");

  const closeMenu = () => setMenuOpen(false);

  const navLinkClass = (active: boolean) =>
    `text-sm font-semibold ${active ? "text-fg" : "text-fg-muted hover:text-fg"}`;

  const mobileLinkClass = (active: boolean) =>
    `block rounded px-3 py-2 text-sm ${
      active ? "bg-active font-medium text-fg" : "text-fg-muted hover:bg-active"
    }`;

  const subNavPillClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold ${
      active ? "bg-status text-status-fg" : "text-fg-muted hover:text-fg"
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
                Club admin
              </Link>
            )}
            {isPlatformAdmin && (
              <Link href="/site-admin" className={navLinkClass(siteAdminActive)}>
                Site admin
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
          <div className="hidden border-t border-border px-4 py-2 sm:flex sm:gap-2 sm:px-6">
            <Link href="/admin" className={subNavPillClass(adminLocationsActive)}>
              Locations
            </Link>
            <Link href="/admin/team" className={subNavPillClass(adminTeamActive)}>
              Team
            </Link>
          </div>
        )}

        {isPlatformAdmin && siteAdminActive && (
          <div className="hidden border-t border-border px-4 py-2 sm:flex sm:gap-2 sm:px-6">
            <Link href="/site-admin/orgs" className={subNavPillClass(siteAdminOrgsActive)}>
              Organizations
            </Link>
            <Link href="/site-admin/users" className={subNavPillClass(siteAdminUsersActive)}>
              Users
            </Link>
            <Link href="/site-admin/settings" className={subNavPillClass(siteAdminSettingsActive)}>
              Settings
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
            {isPlatformAdmin && (
              <>
                <div className="my-2 border-t border-border" />
                <Link
                  href="/site-admin/orgs"
                  className={mobileLinkClass(siteAdminOrgsActive)}
                  onClick={closeMenu}
                >
                  Site Admin: Organizations
                </Link>
                <Link
                  href="/site-admin/users"
                  className={mobileLinkClass(siteAdminUsersActive)}
                  onClick={closeMenu}
                >
                  Site Admin: Users
                </Link>
                <Link
                  href="/site-admin/settings"
                  className={mobileLinkClass(siteAdminSettingsActive)}
                  onClick={closeMenu}
                >
                  Site Admin: Settings
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

- [ ] **Step 4: Replace `layout.tsx` with the target content**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { isValidTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import AppShell from "@/components/AppShell";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Court Scheduler",
  description: "Book open court time slots",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [membership, isPlatformAdmin] = await Promise.all([
    getCurrentMembership(supabase, user?.id),
    getIsPlatformAdmin(supabase, user?.id),
  ]);

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const initialTheme = isValidTheme(themeCookie) ? themeCookie : null;

  return (
    <html
      lang="en"
      data-theme={initialTheme ?? undefined}
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell
          userEmail={user?.email ?? null}
          isOrgMember={!!membership}
          isPlatformAdmin={isPlatformAdmin}
          initialTheme={initialTheme}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: PASS (15 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass; no type errors. (`layout.tsx`'s `LayoutProps<"/">` may show a false error if `.next/types/` hasn't been generated yet in this workspace — if so, run `npm run build` once first, per this project's known fresh-workspace artifact, then re-run `tsc --noEmit`.)

- [ ] **Step 7: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx src/app/layout.tsx
git commit -m "Add Site admin nav tab, rename Admin Dashboard to Club admin, pill sub-nav"
```

---

### Task 4: Search panel (click/tap, no hotkey)

**Files:**
- Create: `src/components/SearchPanel.tsx`
- Test: `src/components/SearchPanel.test.tsx`
- Modify: `src/components/AppShell.tsx` (as left by Task 3)
- Modify: `src/components/AppShell.test.tsx` (as left by Task 3)

**Interfaces:**
- Consumes: nothing new from earlier tasks besides `isPlatformAdmin`, already a prop on `AppShell`.
- Produces: `<SearchPanel isPlatformAdmin={boolean} onClose={() => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
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
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: FAIL — `Cannot find module './SearchPanel'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/SearchPanel.tsx
"use client";

import { useEffect, useRef } from "react";

export default function SearchPanel({
  isPlatformAdmin,
  onClose,
}: {
  isPlatformAdmin: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Search"
      className="absolute right-4 top-full z-50 mt-2 w-72 rounded border border-border bg-card p-4 sm:right-6"
    >
      <form action="/cities" className="flex gap-2">
        <input
          name="q"
          placeholder="Search cities"
          aria-label="Search cities"
          autoFocus
          className="w-full rounded border border-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-accent-fg">
          Go
        </button>
      </form>

      {isPlatformAdmin && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <a href="/site-admin/orgs" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Organizations
          </a>
          <a href="/site-admin/users" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Users
          </a>
          <a href="/site-admin/settings" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Settings
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the search button into `AppShell.tsx`**

Edit `src/components/AppShell.tsx`:

Add the import, right after the `ThemeToggle` import:

```
old_string:
import ThemeToggle from "@/components/ThemeToggle";
import type { Theme } from "@/lib/theme";

new_string:
import ThemeToggle from "@/components/ThemeToggle";
import SearchPanel from "@/components/SearchPanel";
import type { Theme } from "@/lib/theme";
```

Add the state, right after `menuOpen`:

```
old_string:
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

new_string:
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
```

Add the desktop search button + panel, before the desktop `ThemeToggle`:

```
old_string:
          <div className="hidden items-center gap-4 sm:flex">
            <ThemeToggle initialTheme={initialTheme} />

new_string:
          <div className="hidden items-center gap-4 sm:flex">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label={searchOpen ? "Close search" : "Open search"}
              aria-expanded={searchOpen}
              className="text-fg-muted hover:text-fg"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {searchOpen && (
              <SearchPanel isPlatformAdmin={isPlatformAdmin} onClose={() => setSearchOpen(false)} />
            )}
            <ThemeToggle initialTheme={initialTheme} />
```

Add the mobile inline search form, right before the divider that precedes the mobile `ThemeToggle`:

```
old_string:
            <div className="my-2 border-t border-border" />
            <div className="px-3 py-2">
              <ThemeToggle initialTheme={initialTheme} />
            </div>

new_string:
            <form action="/cities" className="flex gap-2 px-3 py-2">
              <input
                name="q"
                placeholder="Search cities"
                aria-label="Search cities"
                className="w-full rounded border border-border px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-accent-fg">
                Go
              </button>
            </form>
            <div className="my-2 border-t border-border" />
            <div className="px-3 py-2">
              <ThemeToggle initialTheme={initialTheme} />
            </div>
```

- [ ] **Step 6: Add one integration test to `AppShell.test.tsx`**

Edit `src/components/AppShell.test.tsx`:

```
old_string:
  it("renders children", () => {

new_string:
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
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/SearchPanel.tsx src/components/SearchPanel.test.tsx src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "Add click-to-open search panel (no hotkey)"
```

---

### Task 5: Site-admin server actions

**Files:**
- Create: `src/app/site-admin/actions.ts`

**Interfaces:**
- Consumes: `organizations.is_active`, `users.is_active`/`is_platform_admin`, `org_members.role`, `site_settings` (Task 1) — enforcement is entirely via the RLS policies from Task 1, these actions do no manual role checks (matching every other admin action in this codebase).
- Produces: `toggleOrgActive`, `toggleUserActive`, `togglePlatformAdmin`, `updateAnyOrgMemberRole`, `updateSiteSetting` — consumed by Tasks 6-8.

No test file for this task: this codebase's established convention (`src/app/admin/actions.ts`) verifies server actions live via manual testing rather than unit-testing Supabase mutation calls.

- [ ] **Step 1: Write the actions**

```ts
// src/app/site-admin/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleOrgActive(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const nextActive = formData.get("next_active") === "true";
  const supabase = await createClient();
  await supabase.from("organizations").update({ is_active: nextActive }).eq("id", orgId);
  revalidatePath("/site-admin/orgs");
}

export async function toggleUserActive(formData: FormData) {
  const userId = String(formData.get("user_id"));
  const nextActive = formData.get("next_active") === "true";
  const supabase = await createClient();
  await supabase.from("users").update({ is_active: nextActive }).eq("id", userId);
  revalidatePath("/site-admin/users");
}

export async function togglePlatformAdmin(formData: FormData) {
  const userId = String(formData.get("user_id"));
  const nextValue = formData.get("next_value") === "true";
  const supabase = await createClient();
  await supabase.from("users").update({ is_platform_admin: nextValue }).eq("id", userId);
  revalidatePath("/site-admin/users");
}

export async function updateAnyOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";
  const supabase = await createClient();
  await supabase.from("org_members").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  revalidatePath("/site-admin/users");
}

export async function updateSiteSetting(formData: FormData) {
  const key = String(formData.get("key"));
  const value = String(formData.get("value") ?? "");
  const supabase = await createClient();
  await supabase
    .from("site_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  revalidatePath("/site-admin/settings");
  revalidatePath("/");
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test changes in this task).

- [ ] **Step 4: Commit**

```bash
git add src/app/site-admin/actions.ts
git commit -m "Add site-admin server actions"
```

---

### Task 6: `/site-admin` redirect + Organizations page

**Files:**
- Create: `src/app/site-admin/page.tsx`
- Test: `src/app/site-admin/page.test.tsx`
- Create: `src/app/site-admin/orgs/page.tsx`
- Test: `src/app/site-admin/orgs/page.test.tsx`

**Interfaces:**
- Consumes: `getIsPlatformAdmin` (Task 2), `toggleOrgActive` (Task 5).

- [ ] **Step 1: Write the failing test for the redirect**

```tsx
// src/app/site-admin/page.test.tsx
import { describe, it, expect, vi } from "vitest";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import SiteAdminPage from "./page";

describe("SiteAdminPage", () => {
  it("redirects to /site-admin/orgs", () => {
    SiteAdminPage();
    expect(mockRedirect).toHaveBeenCalledWith("/site-admin/orgs");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/site-admin/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Write the redirect page**

```tsx
// src/app/site-admin/page.tsx
import { redirect } from "next/navigation";

export default function SiteAdminPage() {
  redirect("/site-admin/orgs");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/site-admin/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the Organizations page**

```tsx
// src/app/site-admin/orgs/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SiteAdminOrgsPage from "./page";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

type OrgRow = {
  id: string;
  name: string;
  is_active: boolean;
  org_members: { user_id: string }[];
  locations: { id: string; courts: { id: string }[] }[];
};

function buildOrg(overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    id: "org-1",
    name: "Ace Volleyball Club",
    is_active: true,
    org_members: [{ user_id: "user-1" }],
    locations: [{ id: "loc-1", courts: [{ id: "court-1" }] }],
    ...overrides,
  };
}

function mockClient({ isPlatformAdmin, orgs }: { isPlatformAdmin: boolean; orgs: OrgRow[] }) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { is_platform_admin: isPlatformAdmin } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          order: () => Promise.resolve({ data: orgs }),
        }),
      };
    },
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("SiteAdminOrgsPage", () => {
  it("shows an access-denied message for a non-platform-admin", async () => {
    mockClient({ isPlatformAdmin: false, orgs: [] });
    const ui = await SiteAdminOrgsPage();
    render(ui);
    expect(screen.getByText("You don't have access to site admin.")).toBeInTheDocument();
  });

  it("lists organizations with member, location, and court counts for a platform admin", async () => {
    mockClient({ isPlatformAdmin: true, orgs: [buildOrg()] });
    const ui = await SiteAdminOrgsPage();
    render(ui);
    expect(screen.getByText("Ace Volleyball Club")).toBeInTheDocument();
    expect(screen.getByText("1 member · 1 location · 1 court")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows an Inactive badge and Activate button for a deactivated org", async () => {
    mockClient({ isPlatformAdmin: true, orgs: [buildOrg({ is_active: false })] });
    const ui = await SiteAdminOrgsPage();
    render(ui);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/app/site-admin/orgs/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 7: Write the Organizations page**

```tsx
// src/app/site-admin/orgs/page.tsx
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { toggleOrgActive } from "@/app/site-admin/actions";

export default async function SiteAdminOrgsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = await getIsPlatformAdmin(supabase, user?.id);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
        You don&apos;t have access to site admin.
      </div>
    );
  }

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, is_active, org_members(user_id), locations(id, courts(id))")
    .order("name");

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Organizations</h1>

      {(!orgs || orgs.length === 0) && (
        <p className="mt-6 text-sm text-fg-muted">No organizations yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {(orgs ?? []).map((org) => {
          const memberCount = org.org_members?.length ?? 0;
          const locationCount = org.locations?.length ?? 0;
          const courtCount = (org.locations ?? []).reduce(
            (sum, location) => sum + (location.courts?.length ?? 0),
            0
          );

          return (
            <li
              key={org.id}
              className="flex items-center justify-between gap-3 rounded border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {org.name}{" "}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      org.is_active ? "bg-status text-status-fg" : "bg-active text-fg-muted"
                    }`}
                  >
                    {org.is_active ? "Active" : "Inactive"}
                  </span>
                </p>
                <p className="text-sm text-fg-muted">
                  {memberCount} member{memberCount === 1 ? "" : "s"} · {locationCount} location
                  {locationCount === 1 ? "" : "s"} · {courtCount} court{courtCount === 1 ? "" : "s"}
                </p>
              </div>
              <form action={toggleOrgActive}>
                <input type="hidden" name="org_id" value={org.id} />
                <input type="hidden" name="next_active" value={String(!org.is_active)} />
                <button type="submit" className="text-sm text-link underline">
                  {org.is_active ? "Deactivate" : "Activate"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app/site-admin/orgs/page.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/app/site-admin/page.tsx src/app/site-admin/page.test.tsx src/app/site-admin/orgs/page.tsx src/app/site-admin/orgs/page.test.tsx
git commit -m "Add /site-admin redirect and Organizations page"
```

---

### Task 7: Users page

**Files:**
- Create: `src/app/site-admin/users/page.tsx`
- Test: `src/app/site-admin/users/page.test.tsx`

**Interfaces:**
- Consumes: `getIsPlatformAdmin` (Task 2), `toggleUserActive`/`togglePlatformAdmin`/`updateAnyOrgMemberRole` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/site-admin/users/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SiteAdminUsersPage from "./page";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

type UserRow = {
  id: string;
  email: string;
  is_platform_admin: boolean;
  is_active: boolean;
};

function buildUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-2",
    email: "player@example.com",
    is_platform_admin: false,
    is_active: true,
    ...overrides,
  };
}

function chainable(resolveValue: { data: unknown }): any {
  const obj: any = {
    ilike: () => obj,
    order: () => obj,
    limit: () => Promise.resolve(resolveValue),
  };
  return obj;
}

function mockClient({
  isPlatformAdmin,
  users,
  memberships = [],
}: {
  isPlatformAdmin: boolean;
  users: UserRow[];
  memberships?: { org_id: string; role: string; organization: { name: string } }[];
}) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "org_members") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: memberships }),
          }),
        };
      }
      return {
        select: (cols: string) => {
          if (cols === "is_platform_admin") {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_platform_admin: isPlatformAdmin } }),
              }),
            };
          }
          return chainable({ data: users });
        },
      };
    },
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("SiteAdminUsersPage", () => {
  it("shows an access-denied message for a non-platform-admin", async () => {
    mockClient({ isPlatformAdmin: false, users: [] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("You don't have access to site admin.")).toBeInTheDocument();
  });

  it("lists users with site-admin and active toggles for a platform admin", async () => {
    mockClient({ isPlatformAdmin: true, users: [buildUser()] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("player@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make site admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows a search-specific empty state when q matches no users", async () => {
    mockClient({ isPlatformAdmin: true, users: [] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({ q: "nobody" }) });
    render(ui);
    expect(screen.getByText('No users match "nobody".')).toBeInTheDocument();
  });

  it("renders a role-edit form for a non-owner org membership", async () => {
    mockClient({
      isPlatformAdmin: true,
      users: [buildUser()],
      memberships: [
        { org_id: "org-1", role: "staff", organization: { name: "Ace Volleyball Club" } },
      ],
    });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Ace Volleyball Club")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("staff");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/site-admin/users/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Write the Users page**

```tsx
// src/app/site-admin/users/page.tsx
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import {
  toggleUserActive,
  togglePlatformAdmin,
  updateAnyOrgMemberRole,
} from "@/app/site-admin/actions";

export default async function SiteAdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const rawQ = (await searchParams).q;
  const q = Array.isArray(rawQ) ? rawQ[0] : rawQ;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = await getIsPlatformAdmin(supabase, user?.id);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
        You don&apos;t have access to site admin.
      </div>
    );
  }

  const trimmedQ = q?.trim();
  const usersQuery =
    trimmedQ && trimmedQ.length > 0
      ? supabase
          .from("users")
          .select("id, email, is_platform_admin, is_active")
          .ilike("email", `%${trimmedQ}%`)
          .order("created_at", { ascending: false })
          .limit(50)
      : supabase
          .from("users")
          .select("id, email, is_platform_admin, is_active")
          .order("created_at", { ascending: false })
          .limit(50);
  const { data: users } = await usersQuery;

  const usersWithMemberships = await Promise.all(
    (users ?? []).map(async (u) => {
      const { data: memberships } = await supabase
        .from("org_members")
        .select("org_id, role, organization:organizations(name)")
        .eq("user_id", u.id);
      return {
        ...u,
        memberships: (memberships ?? []).map((m) => {
          const org = Array.isArray(m.organization) ? m.organization[0] : m.organization;
          return { orgId: m.org_id, role: m.role, orgName: org?.name ?? "" };
        }),
      };
    })
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Users</h1>

      <form action="/site-admin/users" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by email"
          aria-label="Search by email"
          className="w-full rounded border border-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-accent-fg">
          Search
        </button>
      </form>

      {usersWithMemberships.length === 0 && (
        <p className="mt-6 text-sm text-fg-muted">
          {q ? `No users match "${q}".` : "No users yet."}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {usersWithMemberships.map((u) => (
          <li key={u.id} className="rounded border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{u.email}</span>
              <div className="flex items-center gap-3">
                <form action={togglePlatformAdmin}>
                  <input type="hidden" name="user_id" value={u.id} />
                  <input type="hidden" name="next_value" value={String(!u.is_platform_admin)} />
                  <button type="submit" className="text-xs underline">
                    {u.is_platform_admin ? "Remove site admin" : "Make site admin"}
                  </button>
                </form>
                <form action={toggleUserActive}>
                  <input type="hidden" name="user_id" value={u.id} />
                  <input type="hidden" name="next_active" value={String(!u.is_active)} />
                  <button type="submit" className="text-xs text-link underline">
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </div>

            {u.memberships.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {u.memberships.map((m) => (
                  <li key={m.orgId} className="flex items-center gap-2 text-sm text-fg-muted">
                    <span>{m.orgName}</span>
                    {m.role === "owner" ? (
                      <span>Owner</span>
                    ) : (
                      <form action={updateAnyOrgMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="org_id" value={m.orgId} />
                        <input type="hidden" name="user_id" value={u.id} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          className="rounded border border-border px-2 py-1 text-sm"
                        >
                          <option value="admin">Admin</option>
                          <option value="staff">Staff</option>
                        </select>
                        <button type="submit" className="text-xs underline">
                          Save
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/site-admin/users/page.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/site-admin/users/page.tsx src/app/site-admin/users/page.test.tsx
git commit -m "Add site-admin Users page"
```

---

### Task 8: Settings page

**Files:**
- Create: `src/app/site-admin/settings/page.tsx`

**Interfaces:**
- Consumes: `getIsPlatformAdmin` (Task 2), `updateSiteSetting` (Task 5), `site_settings` table (Task 1).

No test file for this task: a single-field form reading/writing one row, following this codebase's convention of verifying simple settings forms live (matches `admin/page.tsx`'s untested "Edit club settings" form).

- [ ] **Step 1: Write the Settings page**

```tsx
// src/app/site-admin/settings/page.tsx
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { updateSiteSetting } from "@/app/site-admin/actions";

export default async function SiteAdminSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = await getIsPlatformAdmin(supabase, user?.id);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
        You don&apos;t have access to site admin.
      </div>
    );
  }

  const { data: setting } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "announcement_banner")
    .maybeSingle();

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Settings</h1>

      <form action={updateSiteSetting} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="key" value="announcement_banner" />
        <label className="flex flex-col gap-1 text-sm">
          Announcement banner
          <textarea
            name="value"
            defaultValue={setting?.value ?? ""}
            placeholder="Shown at the top of the home page for everyone. Leave blank to hide it."
            rows={3}
            className="rounded border border-border px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="w-fit rounded bg-accent px-4 py-2 text-sm text-accent-fg">
          Save
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test changes in this task).

- [ ] **Step 4: Commit**

```bash
git add src/app/site-admin/settings/page.tsx
git commit -m "Add site-admin Settings page"
```

---

### Task 9: Announcement banner on the home page

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `site_settings` table (Task 1).

No new automated test: matches this codebase's established convention of verifying server-component route composition live rather than unit-testing `page.tsx` files (e.g. the `cities/page.tsx` search-param hop has no dedicated test either).

- [ ] **Step 1: Replace `page.tsx` with the target content**

```tsx
// src/app/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities, CITY_OVERRIDE_COOKIE } from "@/lib/cities";
import { resolveHomeCity } from "@/lib/cityGrouping";
import { clearCityOverride } from "@/app/actions/cityPreference";
import CityContent from "@/components/CityContent";
import AllCitiesContent from "@/components/AllCitiesContent";
import LandingPage from "@/components/LandingPage";

export default async function Home() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const overrideCity = cookieStore.get(CITY_OVERRIDE_COOKIE)?.value ?? null;

  const [
    {
      data: { user },
    },
    availableCities,
    { data: bannerSetting },
  ] = await Promise.all([
    supabase.auth.getUser(),
    listActiveCities(supabase),
    supabase.from("site_settings").select("value").eq("key", "announcement_banner").maybeSingle(),
  ]);
  const announcementBanner = bannerSetting?.value?.trim() || null;

  let defaultCity: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("default_city")
      .eq("id", user.id)
      .maybeSingle();
    defaultCity = profile?.default_city ?? null;
  }
  const resolvedCity = resolveHomeCity({ overrideCity, defaultCity, availableCities });

  const banner = announcementBanner && (
    <div className="bg-status px-4 py-2 text-center text-sm text-status-fg">{announcementBanner}</div>
  );

  if (!resolvedCity) {
    if (!user) {
      return (
        <>
          {banner}
          <LandingPage />
        </>
      );
    }
    return (
      <>
        {banner}
        <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
          <AllCitiesContent />
        </div>
      </>
    );
  }

  const overrideDiffersFromDefault = overrideCity === resolvedCity && overrideCity !== defaultCity;

  return (
    <>
      {banner}
      <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

        <div className="mt-2 flex items-center justify-between text-sm text-fg-muted">
          <span>Browsing: {resolvedCity}</span>
          <span className="flex items-center gap-3">
            <Link href="/cities" className="underline">
              See all cities
            </Link>
            {overrideDiffersFromDefault && (
              <form action={clearCityOverride}>
                <button type="submit" className="underline">
                  {defaultCity ? "Reset to my city" : "Clear"}
                </button>
              </form>
            )}
          </span>
        </div>

        <CityContent city={resolvedCity} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 3: Manual verification**

Set an announcement banner via `/site-admin/settings`; confirm it renders on `/` for a logged-out visitor, a city-resolved player, and the all-cities fallback. Clear it; confirm it disappears from all three.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Render the site-wide announcement banner on the home page"
```

---

### Task 10: End-to-end manual verification and RLS impersonation check

**Files:** none (verification only — no code changes).

**Interfaces:** exercises everything from Tasks 1-9 together as a signed-in user, matching the spec's manual verification plan.

- [ ] **Step 1: Role-based nav visibility**

As the seeded bootstrap platform-admin account (`bdfink.su@gmail.com`): confirm `Site admin` renders in the top nav, and (if also an org member) `Club admin` renders too, each with its own pill sub-nav on its own routes. As a plain player account: confirm neither admin tab renders, and the search panel shows no site-admin links.

- [ ] **Step 2: Organization deactivation**

Create or pick a test org with at least one location/court. As the platform admin, deactivate it via `/site-admin/orgs`. As a logged-out visitor (or a plain player who is not a member of that org), confirm its city/locations no longer appear on `/cities` or the homepage. As a member of that org, confirm `/admin` still shows its locations. Reactivate it and confirm it reappears publicly.

- [ ] **Step 3: User deactivation**

As the platform admin, deactivate a test player account via `/site-admin/users`. As that player, confirm they can still log in and view existing bookings, but attempting to create a new booking fails (surfaces the existing generic booking-error path). Reactivate the account and confirm booking works again.

- [ ] **Step 4: Role-impersonation RLS check**

Using a real session + PostgREST (not a superuser `psql`/`DATABASE_URL` connection — see the process note in `docs/STATUS.md` about why that bypasses RLS entirely) for a plain, non-platform-admin test account: confirm a direct PATCH attempt setting `is_platform_admin: true` on that account's own `users` row is rejected (the new `"users platform admin all"` policy only permits this for an existing platform admin, and the pre-existing `"users update own"` policy from `0002_rls.sql` has no `is_platform_admin` column restriction of its own — this check confirms there is no gap between the two). Also confirm that account cannot PATCH `organizations.is_active` on an org it doesn't belong to.

- [ ] **Step 5: Report and update STATUS.md**

Add an entry to `docs/STATUS.md` describing what shipped (role-aware nav, platform admin tier, org/user deactivation, site settings banner), in this repo's existing style — what was built, key file references, what was verified, anything deliberately deferred (per the spec's Non-goals: no Auth-level account banning, no per-court staff assignment, no live-search autocomplete). Commit:

```bash
git add docs/STATUS.md
git commit -m "Document nav redesign and platform admin rollout in STATUS.md"
```

## Final Check

- [ ] Re-read `docs/superpowers/specs/2026-09-08-nav-redesign-platform-admin-design.md` top to bottom and confirm every section has a corresponding task above: role model + data changes (Task 1), nav changes (Tasks 3-4), site-admin pages (Tasks 6-8), announcement banner (Task 9), testing plan (spread across Tasks 2-7's test steps), manual verification plan (Task 10).
- [ ] `docs/STATUS.md` update is Task 10's own last step, not a separate step to remember later.
