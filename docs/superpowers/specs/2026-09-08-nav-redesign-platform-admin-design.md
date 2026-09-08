# Navigation Redesign + Platform Admin — Design Spec

## Goal

Replace the single flat top nav with role-aware navigation that scales to
three tiers of user — player, club/location admin, and a new platform-wide
site admin — plus a tap-to-open search panel that replaces plain-text
browsing links. Ship the site-admin tier for real: a new `is_platform_admin`
role backed by RLS, with working (not stubbed) pages for organizations,
users, and one site-wide setting.

## Non-goals

- No keyboard shortcut for search (explicitly dropped — click/tap only).
- No per-court staff assignment (confirmed: club/location admin keeps
  today's `org_members` org-wide scope — this is a nav/labeling change,
  not a new permission model).
- No Supabase Auth-level account banning (no service-role Admin API calls
  anywhere in this codebase today — introducing one is out of scope). User
  "deactivation" is enforced at the RLS/app-action layer: a deactivated
  user can't create new bookings or event registrations. They are not
  signed out and can still view their existing data.
- No live-searching/autocomplete dropdown. The search panel is a plain GET
  form to the existing `/cities?q=` flow (built in the prior landing-page
  work) — no new fetch/debounce logic.
- No mockup-shown avatar-photo support — the existing initials-circle
  treatment from the mockup is illustrative; real implementation uses the
  same `userEmail` string AppShell already has (no new profile-photo field).
- Site-wide settings starts with exactly one setting (announcement banner).
  The mechanism (key/value rows) supports adding more later without a
  schema change, but no other settings ship in this pass.

## Role model

| Tier | Backing | Scope | Status |
|---|---|---|---|
| Player | `users` row | Book courts, manage own bookings/events | exists |
| Club/location admin | `org_members.role` (owner/admin/staff) | Their own org's locations, courts, events, team | exists — nav relabels it |
| Site admin | `users.is_platform_admin` (new) | Every org, every location, every user, site settings | new |

Tiers are additive, not exclusive — a user can be a club admin on their own
org and a site admin at the same time (this will be true for the seeded
bootstrap account). Nav shows every tab a user qualifies for.

## Data model changes

New migration `supabase/migrations/0032_platform_admin.sql`:

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
    true -- a user row that doesn't exist yet (mid-signup) isn't blocked
  );
$$;

-- Platform admins get full cross-org access. Postgres OR-combines
-- multiple permissive policies per command, so these are additive to
-- every existing policy below -- nothing existing is dropped for this part.
create policy "organizations platform admin all" on organizations
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "org_members platform admin all" on org_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "users platform admin all" on users
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Public browsing must stop surfacing a deactivated org's locations, while
-- the org's own members (to manage/reactivate) and platform admins (to
-- review it) keep seeing it. This DOES change existing behavior, so the
-- old policy is dropped and replaced rather than added-to.
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

-- Site-wide settings: key/value so more rows can be added later without
-- a migration. Publicly readable (the banner must render for logged-out
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
-- (organizations, locations, ...) relies on Supabase's default public-schema
-- privileges plus RLS alone, with explicit grants reserved for VIEWS
-- (booked_slots, event_registration_counts) that bypass owner privileges.
-- site_settings is a plain table, so it follows that same convention.

insert into site_settings (key, value) values ('announcement_banner', '');

-- Bootstrap: seed the project owner as the first (and for now, only)
-- platform admin. Matches the existing seed.sql convention of bootstrapping
-- the first owner by email.
update users set is_platform_admin = true where email = 'bdfink.su@gmail.com';
```

## Nav changes (`src/components/AppShell.tsx`)

**New prop:** `isPlatformAdmin: boolean`, threaded from `src/app/layout.tsx`
via a new `getIsPlatformAdmin(supabase, userId)` helper in a new
`src/lib/platformAdmin.ts`:

```ts
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

`layout.tsx` fetches this alongside the existing `getCurrentMembership` call
(both keyed off the same `user?.id`, so `Promise.all` them) and passes
`isPlatformAdmin={isPlatformAdmin}` to `AppShell`.

**Label change:** the existing `Admin Dashboard` link (href `/admin`,
already gated on `isOrgMember`) is relabeled `Club admin`. No behavior
change.

**New tab:** a `Site admin` link (href `/site-admin`), gated on
`isPlatformAdmin`, placed after `Club admin` in both the desktop nav and
the mobile menu, using the same `navLinkClass`/`mobileLinkClass` helpers.

**New pathname flags**, alongside the existing ones:

```ts
const siteAdminActive = pathname.startsWith("/site-admin");
const siteAdminOrgsActive = pathname === "/site-admin" || pathname.startsWith("/site-admin/orgs");
const siteAdminUsersActive = pathname.startsWith("/site-admin/users");
const siteAdminSettingsActive = pathname.startsWith("/site-admin/settings");
```

**Sub-nav restyle:** the existing admin sub-nav strip (`isOrgMember &&
adminActive`, currently plain underlined text via `subNavLinkClass`) is
restyled to the pill treatment from the mockup, and the same strip pattern
is duplicated for site admin:

```ts
const subNavPillClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-semibold ${
    active ? "bg-status text-status-fg" : "text-fg-muted hover:text-fg"
  }`;
```

Replacing the existing `<div className="hidden border-t ... sm:flex sm:gap-5 sm:px-6">` block's link classes from `subNavLinkClass` to `subNavPillClass`
(copy/hrefs unchanged: Locations `/admin`, Team `/admin/team`), and adding a
second, identically-structured block gated on `isPlatformAdmin &&
siteAdminActive` with three pills: Organizations (`/site-admin/orgs`),
Users (`/site-admin/users`), Settings (`/site-admin/settings`).

**Search — click/tap only, no hotkey:** a new `searchOpen` boolean in local
state (`useState(false)`) plus a search-trigger button next to the theme
toggle (desktop) and inside the mobile menu. This repo has no icon library
(the existing hamburger button uses plain glyphs `☰`/`✕`), so the button
uses an inline SVG magnifying-glass icon (18×18, `stroke="currentColor"` so
it inherits `text-fg`/`text-fg-muted`) rather than a new dependency or an
emoji. Clicking it renders `<SearchPanel isPlatformAdmin={isPlatformAdmin} onClose={...} />`
(new component, `src/components/SearchPanel.tsx`) as a small anchored panel
under the header — not a full-screen modal, so it follows the existing
`position: relative` header + `absolute` dropdown pattern already implied by
the sticky header, no `position: fixed` needed.

```tsx
"use client";

export default function SearchPanel({
  isPlatformAdmin,
  onClose,
}: {
  isPlatformAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-full z-50 mt-2 w-72 rounded border border-border bg-card p-4 shadow-none sm:right-6">
      <form action="/cities" className="flex gap-2">
        <input
          name="q"
          placeholder="Search cities"
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

No `box-shadow`/blur — `shadow-none` above is deliberate, the border alone
delineates the panel per the codebase's existing flat-card convention
(`AllCitiesContent`'s `border border-border bg-card`). Closing: clicking the
search button again toggles it shut; a plain click-outside handler
(`useEffect` + `document.addEventListener("mousedown", ...)` scoped to a
ref on the panel, matching no existing precedent in this codebase but a
standard, minimal pattern) also closes it. Escape key closes it too.

## Site-admin pages

Guard pattern for every `/site-admin/*` page (mirrors the existing
`team/page.tsx` access-denied convention — no shared layout-level guard
component exists in this codebase today, so each page repeats the same
three-line check, matching how `admin/team/page.tsx` already does its own
independent `isOwnerOrAdmin` check rather than relying on a parent layout):

```tsx
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
```

### `/site-admin/page.tsx`

Redirects to `/site-admin/orgs` (`redirect("/site-admin/orgs")` from
`next/navigation`) after the same guard check.

### `/site-admin/orgs/page.tsx`

Query: `organizations` — `select("id, name, is_active, org_members(user_id), locations(id, courts(id))")`.
Render a list: org name, active/inactive badge (`bg-status text-status-fg`
pill when active, `bg-active text-fg-muted` when inactive), member count
(`org.org_members?.length ?? 0`), location count (`org.locations?.length ??
0`), court count (sum of `location.courts?.length` across
`org.locations`) — the same `?.length` counting pattern `admin/page.tsx`
already uses for a single org's locations, just one level deeper. No
`(count)` aggregate syntax (unused elsewhere in this codebase; plain
`.length` on the nested arrays is simpler and consistent). Each row has a
form posting to a new
`toggleOrgActive(formData)` action (`src/app/site-admin/actions.ts`):

```ts
export async function toggleOrgActive(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const nextActive = formData.get("next_active") === "true";
  const supabase = await createClient();
  await supabase.from("organizations").update({ is_active: nextActive }).eq("id", orgId);
  revalidatePath("/site-admin/orgs");
}
```

(RLS's new `organizations platform admin all` policy is what actually makes
this succeed for a non-member — the action itself does no manual role
check, consistent with every other admin action in this codebase relying on
RLS as the enforcement layer per this project's stated convention, not
app-level checks.)

### `/site-admin/users/page.tsx`

Search: a GET `?q=` param (same `searchParams: Promise<{ q?: string }>`
pattern as `cities/page.tsx`), filtering by email via
`.ilike("email", `%${q}%`)` when present, else the first 50 users ordered by
`created_at desc` (no need for a client-side filter helper like
`filterCitiesByQuery` — this is a server-side `ilike`, a different shape of
query, so it doesn't reuse that function).

For each user row, show: email, `is_platform_admin` toggle (form → new
`togglePlatformAdmin` action), `is_active` toggle (form → new
`toggleUserActive` action), and their org memberships (a second query,
`org_members.select("org_id, role, organization:organizations(name)")
.eq("user_id", ...)`, one per row — acceptable N+1 at this admin-only,
low-traffic scale, matching this codebase's existing tolerance for
per-location queries in `admin/page.tsx`) each with a role `<select>` +
save form reusing the same shape as `admin/team/page.tsx`'s role editor but
posting to a new `updateAnyOrgMemberRole` action (identical body to
`updateOrgMemberRole` in `admin/actions.ts` minus the org-scoped
`getRoleForOrg` permission check, since RLS's `org_members platform admin
all` policy is the actual gate).

### `/site-admin/settings/page.tsx`

Query: `site_settings.select("value").eq("key", "announcement_banner").maybeSingle()`.
A single textarea form (`updateSiteSetting` action, upserts the row by
`key`). Empty value means no banner shows anywhere.

## Announcement banner rendering

`src/app/page.tsx` fetches `site_settings` (one extra query, alongside the
existing `Promise.all`) and — when `value` is non-empty — renders a banner
above all three existing branches (`LandingPage`, the all-cities fallback,
and the resolved-city view), so it's visible regardless of login state or
city selection:

```tsx
{announcementBanner && (
  <div className="bg-status px-4 py-2 text-center text-sm text-status-fg">{announcementBanner}</div>
)}
```

## Testing plan

- `src/lib/platformAdmin.test.ts` (new, mirrors no existing precedent
  exactly but follows the plain-function-test style of `cityGrouping.test.ts`):
  mock Supabase client, assert `getIsPlatformAdmin` returns `false` for no
  user, `false`/`true` based on the mocked row.
- `AppShell.test.tsx` (existing, extend): assert `Site admin` link renders
  only when `isPlatformAdmin` is true; assert `Club admin` label (renamed
  from `Admin Dashboard`) still gates on `isOrgMember`; assert the search
  button opens `SearchPanel` on click.
- `src/components/SearchPanel.test.tsx` (new): renders the cities search
  form always; renders the three site-admin links only when
  `isPlatformAdmin` is true; calls `onClose` when a site-admin link is
  clicked.
- `src/app/site-admin/orgs/page.test.tsx`,
  `src/app/site-admin/users/page.test.tsx` (new, using the Supabase-mocking
  pattern established in `AllCitiesContent.test.tsx`): access-denied render
  for a non-platform-admin; row rendering with fixture orgs/users; the
  `q` search-filter branch for the users page.
- No test needed for `toggleOrgActive`/`toggleUserActive`/
  `togglePlatformAdmin`/`updateAnyOrgMemberRole` themselves — this
  codebase's established convention (per `admin/actions.ts`, untested)
  verifies server actions live rather than unit-testing Supabase mutation
  calls.

## Manual verification plan

1. As the seeded platform-admin account: confirm both `Club admin` (if also
   an org member) and `Site admin` tabs render; confirm the pill sub-nav
   under each.
2. As a plain player: confirm neither admin tab renders; confirm the search
   panel has no site-admin links.
3. Deactivate a test org via `/site-admin/orgs`; confirm its city/locations
   disappear from `/cities` and the homepage for a logged-out/non-member
   session, but the org's own admin can still see it under `/admin`.
4. Deactivate a test player account via `/site-admin/users`; confirm they
   can still log in and view existing bookings, but a new booking attempt
   fails (RLS rejection surfaces as the existing generic booking-error
   path).
5. Set an announcement banner via `/site-admin/settings`; confirm it
   renders on `/` for a logged-out visitor, a city-resolved player, and the
   all-cities fallback. Clear it; confirm it disappears.
