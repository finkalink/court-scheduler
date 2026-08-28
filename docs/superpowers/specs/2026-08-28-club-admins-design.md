# Club Admins — Design Spec

Status: approved for implementation
Date: 2026-08-28

## Goal

Let an org's owner/admin grant an existing player account admin access to
their club (org), without manual SQL, and introduce a real distinction
between `admin`/`owner` and `staff` capabilities — today `org_members.role`
is stored but nothing in the app branches on it.

This is the first sub-project of a two-part backlog item. The second part
— restructuring the player-facing home page into a City > Club > Location >
Court drilldown — is a separate spec, deferred until this one ships.

## Non-goals (explicitly out of scope)

- **Ownership transfer / assigning a new `owner`.** The role picker in this
  feature only offers `admin` and `staff`. Promoting/transferring `owner`
  status is part of the separately-deferred `v2-org-creation-deferred` spec,
  which needs its own platform-admin design.
- **Creating brand-new organizations.** Unchanged — still manual/SQL.
- **Pending invites for accounts that don't exist yet.** Adding someone by
  email requires them to already have a Court Scheduler account (the
  `public.users` row created at signup). No match → a clear error asking
  them to sign up first, not a stored pending invite.
- **A player-facing "which orgs am I a member of" switcher.** A user with
  memberships in more than one org still lands on their first membership,
  same pre-existing, deliberate scope cut as today.

## Staff vs. owner/admin capability split

| Capability | staff | admin / owner |
|---|---|---|
| View courts/locations list | yes | yes |
| Edit weekly availability hours | yes | yes |
| Add/edit/remove date overrides | yes | yes |
| Push general hours to all courts | yes | yes |
| Cancel a booking / edit its requested config | yes | yes |
| Create or edit a court | no | yes |
| Activate/deactivate a court | no | yes |
| Create or edit a location | no | yes |
| View/manage the admin roster (`/admin/team`) | no | yes |
| Edit organization settings | no | yes |

## Data model & RLS changes

New migration: `supabase/migrations/0010_club_admin_roles.sql`

```sql
-- Tighten to owner/admin only -- staff no longer creates/edits courts or
-- locations (previously any org member could, via is_org_member).
drop policy "locations write member" on locations;
create policy "locations write admin" on locations
  for insert with check (public.is_org_admin(org_id));
drop policy "locations update member" on locations;
create policy "locations update admin" on locations
  for update using (public.is_org_admin(org_id));

drop policy "courts write member" on courts;
create policy "courts write admin" on courts
  for insert with check (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_admin(l.org_id)
    )
  );
drop policy "courts update member" on courts;
create policy "courts update admin" on courts
  for update using (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_admin(l.org_id)
    )
  );

-- availability_rules, slot_overrides, and bookings policies are unchanged
-- (still is_org_member) -- staff keeps full access to hours and bookings.

-- Previously missing entirely: org_members had insert/delete but no update
-- policy, needed for changing an existing member's role.
create policy "org_members update admin" on org_members
  for update using (public.is_org_admin(org_id));

-- Narrow email -> user id lookup so an admin's "add by email" flow can find
-- an existing player account. The `users` table's own RLS only allows
-- selecting your own row, so this can't go through the normal client --
-- same security-definer pattern already used by is_org_member/is_org_admin,
-- deliberately scoped to return only an id, nothing else about the user.
create function public.lookup_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from users where lower(email) = lower(lookup_email);
$$;

grant execute on function public.lookup_user_id_by_email(text) to authenticated;
```

Apply via `npm run migrate -- supabase/migrations/0010_club_admin_roles.sql`
against the live Supabase project, same as prior migrations.

## Pure logic (`src/lib/orgRoles.ts`, built test-first)

```ts
export type OrgRole = "owner" | "admin" | "staff";

export function isOwnerOrAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

// Guards against an org ending up with zero owners. Called before removing
// a member or changing their role away from "owner" -- both operations take
// the member from "owner" to "not owner", so the check doesn't need to know
// which one is happening, only the member's role *before* the change and
// how many owners the org currently has.
export function wouldRemoveLastOwner(ownerCount: number, targetCurrentRole: OrgRole): boolean {
  return targetCurrentRole === "owner" && ownerCount <= 1;
}
```

Test cases (`src/lib/orgRoles.test.ts`):
- not an owner today → never blocks, regardless of owner count
- sole owner → blocked
- one of two (or more) owners → not blocked
- zero owners recorded (defensive: shouldn't happen, but ownerCount of 0
  with targetCurrentRole "owner" is still blocked, not treated as a no-op)

## I/O helpers (`src/lib/orgMembership.ts`, not unit tested — matches how
other Supabase-querying helpers in this codebase aren't)

```ts
export interface CurrentMembership {
  orgId: string;
  orgName: string | null;
  role: OrgRole;
}

// First org membership for a user -- same lookup already duplicated across
// src/app/layout.tsx, admin/layout.tsx, and admin/page.tsx today; this
// consolidates it and adds `role`, which none of the three currently select.
export async function getCurrentMembership(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<CurrentMembership | null>;

// Role for a *specific* org -- used by pages that already know which org
// they're showing (e.g. a location page, via the location's org_id), so a
// user who happens to belong to more than one org still gets the right
// answer for the org actually being viewed.
export async function getRoleForOrg(
  supabase: SupabaseClient,
  userId: string | undefined,
  orgId: string
): Promise<OrgRole | null>;
```

`src/app/layout.tsx`, `src/app/admin/layout.tsx`, and `src/app/admin/page.tsx`
are refactored to call `getCurrentMembership` instead of their own inline
duplicate queries. Behavior unchanged for all three except that
`admin/page.tsx` now also has `role` available (needed to gate the new
"Team" link).

## Server actions (`src/app/admin/actions.ts`)

**`addOrgMember(formData)`** — fields: `org_id`, `email`, `role` (`admin` |
`staff` only; anything else rejected).
1. `supabase.rpc("lookup_user_id_by_email", { lookup_email: email })`.
2. No match → redirect back to `/admin/team` with an error: "No account
   found for that email — they'll need to sign up first."
3. Match → insert `{ org_id, user_id, role }` into `org_members`. A unique
   violation (already a member) is caught and redirected with "This person
   already has access."
4. Success → redirect to `/admin/team?member_added=1`.

**`updateOrgMemberRole(formData)`** — fields: `org_id`, `user_id`, `role`.
1. Look up the target's current role and the org's owner count.
2. `wouldRemoveLastOwner(ownerCount, currentRole)` → if true, redirect with
   "Can't change the club's last owner." No write.
3. Otherwise update the row, redirect to `/admin/team?role_updated=1`.

**`removeOrgMember(formData)`** — fields: `org_id`, `user_id`.
1. Same last-owner check as above.
2. Otherwise delete the row, redirect to `/admin/team?member_removed=1`.

All three are owner/admin-only at the RLS layer already (existing
`org_members insert/delete admin` policies, plus the new `update admin`
policy above) — these actions don't duplicate that check, consistent with
how the rest of this app defers to RLS for authorization.

## UI changes

**New `/admin/team`** (`src/app/admin/team/page.tsx`)
- Guarded at the top: if `getCurrentMembership(...).role` isn't owner/admin,
  render the same short "you don't have access" message style as
  `admin/layout.tsx`'s existing no-membership screen, instead of the page.
- Roster list: each `org_members` row joined in-app to `public.users` (two
  separate queries — org_members rows, then `users` rows `.in("id", ids)` —
  since `org_members.user_id` references `auth.users`, not `public.users`,
  so there's no automatic Supabase relationship to embed the join with).
  Shows email, current role, a role `<select>` (admin/staff) + Save, and a
  Remove button. The signed-in user's own row still shows Remove (self-
  removal is allowed, subject to the same last-owner guard).
- Add-admin form: email input + role select (admin/staff) + submit →
  `addOrgMember`.
- Success/error banners follow the existing `SuccessBanner` / inline-error
  query-param convention used elsewhere (e.g. `override_error` on the court
  page).

**`/admin` dashboard** (`src/app/admin/page.tsx`)
- "Team →" link added next to the existing heading, shown only when
  `isOwnerOrAdmin(membership.role)`.

**`/admin/locations/[locationId]`**
- Look up `getRoleForOrg(supabase, user.id, location.org_id)`.
- When `role === "staff"`: hide the "Edit location" disclosure, hide each
  court's "Edit court" disclosure, hide the "Add a court" form. The courts
  list itself (name, status, links into each court's page) stays visible —
  staff still navigates through it to reach hours/overrides.

**`/admin/locations/[locationId]/courts/[courtId]`**
- No changes. Weekly availability, date overrides, and the bookings section
  (cancel + edit requested config) are all staff-permitted.

**`/admin/locations/[locationId]/hours` and `/hours/confirm`**
- No changes, already hours-only.

## Manual verification plan

- As an owner: add an existing player's email as `staff`, confirm they
  appear on `/admin/team`.
- Sign in as that staff account: confirm `/admin/locations/[id]` hides
  edit/add-court/add-location UI, confirm the court's weekly hours, date
  overrides, and booking cancel/edit still work.
- Attempt (as staff, or via a direct request) to hit RLS-protected paths
  (e.g. create a court) and confirm Postgres rejects it.
- As owner, try to remove/demote the sole owner — confirm it's blocked with
  a clear message; add a second owner-role member first (via direct SQL,
  since this feature doesn't expose assigning `owner`) and confirm removing
  one of the two now succeeds.
- Add-by-email with a non-existent email → confirm the "sign up first"
  error, no row created.
- Add-by-email for someone already a member → confirm the "already has
  access" error, no duplicate row.
