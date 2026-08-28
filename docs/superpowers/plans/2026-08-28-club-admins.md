# Club Admins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org owner/admin grant an existing player account admin access via email, with a real `staff` vs `owner`/`admin` capability split enforced at the RLS layer.

**Architecture:** A new RLS migration tightens `locations`/`courts` writes to owner/admin only (hours/overrides/bookings stay open to staff) and adds a security-definer email→user-id lookup function. New pure logic (`orgRoles.ts`) and I/O helpers (`orgMembership.ts`) back three new server actions and a new `/admin/team` roster page; the existing location admin page gets staff-aware UI gating.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (Postgres + RLS + `security definer` functions), Vitest for pure-logic tests.

**Spec:** [docs/superpowers/specs/2026-08-28-club-admins-design.md](../specs/2026-08-28-club-admins-design.md)

## Global Constraints

- The role picker/inputs in this feature must only ever produce `admin` or `staff` — never `owner`. Any unexpected/tampered role value defaults to `staff`, never escalates.
- `staff` keeps full access to: weekly availability, date overrides, general-hours push, and booking cancel/edit-config. It loses: creating/editing courts, creating/editing locations, and the `/admin/team` page.
- Authorization for writes is enforced at the RLS layer (per this app's existing convention) — UI gating is a courtesy, not the security boundary.
- No new email/invite-for-nonexistent-account mechanism — `addOrgMember` requires an existing `public.users` row.
- Every task ends with a commit.

---

### Task 1: RLS migration — staff/admin split + email lookup function

**Files:**
- Create: `supabase/migrations/0010_club_admin_roles.sql`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: RLS policies `locations write admin`, `locations update admin`, `courts write admin`, `courts update admin`, `org_members update admin`; Postgres function `public.lookup_user_id_by_email(text) returns uuid`, callable via `supabase.rpc("lookup_user_id_by_email", { lookup_email })` — later tasks depend on this exact function/param name.

- [ ] **Step 1: Write the migration file**

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

- [ ] **Step 2: Apply the migration to the live Supabase project**

Run: `npm run migrate -- supabase/migrations/0010_club_admin_roles.sql`
Expected: `Applied supabase/migrations/0010_club_admin_roles.sql`

- [ ] **Step 3: Verify the policies and function exist**

Run (adjust nothing — this uses the existing `DATABASE_URL`/`pg` setup already in the repo, same pattern used to spot-check prior migrations):

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const policies = await client.query(\"select tablename, policyname from pg_policies where policyname in ('locations write admin','locations update admin','courts write admin','courts update admin','org_members update admin') order by tablename\");
  console.log('policies:', policies.rows);
  const lookup = await client.query(\"select public.lookup_user_id_by_email('bdfink.su@gmail.com') as id, public.lookup_user_id_by_email('nobody-at-all@example.com') as missing\");
  console.log('lookup:', lookup.rows);
  await client.end();
});
"
```

Expected: 5 policy rows listed, and `lookup` shows a real UUID for `id` and `null` for `missing`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_club_admin_roles.sql
git commit -m "Add RLS split for staff vs owner/admin, and an email->user-id lookup function"
```

---

### Task 2: Pure role logic (`orgRoles.ts`), built test-first

**Files:**
- Create: `src/lib/orgRoles.ts`
- Test: `src/lib/orgRoles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type OrgRole = "owner" | "admin" | "staff"`, `export function isOwnerOrAdmin(role: OrgRole): boolean`, `export function wouldRemoveLastOwner(ownerCount: number, targetCurrentRole: OrgRole): boolean` — Tasks 3 and 4 import these exact names from `@/lib/orgRoles`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isOwnerOrAdmin, wouldRemoveLastOwner } from "@/lib/orgRoles";

describe("isOwnerOrAdmin", () => {
  it("is true for owner and admin, false for staff", () => {
    expect(isOwnerOrAdmin("owner")).toBe(true);
    expect(isOwnerOrAdmin("admin")).toBe(true);
    expect(isOwnerOrAdmin("staff")).toBe(false);
  });
});

describe("wouldRemoveLastOwner", () => {
  it("never blocks when the target isn't currently an owner", () => {
    expect(wouldRemoveLastOwner(1, "admin")).toBe(false);
    expect(wouldRemoveLastOwner(0, "staff")).toBe(false);
  });

  it("blocks when the target is the sole owner", () => {
    expect(wouldRemoveLastOwner(1, "owner")).toBe(true);
  });

  it("does not block when there are other owners", () => {
    expect(wouldRemoveLastOwner(2, "owner")).toBe(false);
    expect(wouldRemoveLastOwner(5, "owner")).toBe(false);
  });

  it("treats an owner count of zero as still blocking (defensive)", () => {
    expect(wouldRemoveLastOwner(0, "owner")).toBe(true);
  });
});
```

Save this as `src/lib/orgRoles.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- orgRoles`
Expected: FAIL — `Failed to resolve import "@/lib/orgRoles"`.

- [ ] **Step 3: Write the implementation**

```ts
export type OrgRole = "owner" | "admin" | "staff";

export function isOwnerOrAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

// Guards against an org ending up with zero owners. Called before removing
// a member or changing their role away from "owner" -- both operations take
// the member from "owner" to "not owner", so the check only needs the
// member's role *before* the change and how many owners the org currently
// has, not which specific operation is happening.
export function wouldRemoveLastOwner(ownerCount: number, targetCurrentRole: OrgRole): boolean {
  return targetCurrentRole === "owner" && ownerCount <= 1;
}
```

Save this as `src/lib/orgRoles.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- orgRoles`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all existing tests still pass (35 total), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/orgRoles.ts src/lib/orgRoles.test.ts
git commit -m "Add pure org-role logic (isOwnerOrAdmin, wouldRemoveLastOwner)"
```

---

### Task 3: Membership I/O helpers + refactor existing lookups

**Files:**
- Create: `src/lib/orgMembership.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `OrgRole` from `@/lib/orgRoles` (Task 2).
- Produces: `export interface CurrentMembership { orgId: string; orgName: string | null; role: OrgRole }`, `export async function getCurrentMembership(supabase: SupabaseClient, userId: string | undefined): Promise<CurrentMembership | null>`, `export async function getRoleForOrg(supabase: SupabaseClient, userId: string | undefined, orgId: string): Promise<OrgRole | null>` — Task 4 uses `getCurrentMembership`, Task 5 uses `getRoleForOrg`.

This task is a behavior-preserving refactor (three call sites already do this exact lookup, slightly differently each time) plus one new field (`role`) becoming available where it wasn't selected before. No new tests — matches this codebase's existing convention that Supabase-querying helpers aren't unit tested, only pure logic is.

- [ ] **Step 1: Create the helpers file**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/orgRoles";

export interface CurrentMembership {
  orgId: string;
  orgName: string | null;
  role: OrgRole;
}

// First org membership for a user. If a user belongs to more than one org,
// this returns whichever one Postgres happens to return first -- same
// pre-existing, deliberate limitation the admin section already has.
export async function getCurrentMembership(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<CurrentMembership | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from("org_members")
    .select("org_id, role, organization:organizations(name)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const org = Array.isArray(data.organization) ? data.organization[0] : data.organization;

  return {
    orgId: data.org_id,
    orgName: org?.name ?? null,
    role: data.role as OrgRole,
  };
}

// Role for a specific org -- for pages that already know which org they're
// showing (e.g. via a location's org_id), so a user in more than one org
// still gets the right answer for the org actually being viewed.
export async function getRoleForOrg(
  supabase: SupabaseClient,
  userId: string | undefined,
  orgId: string
): Promise<OrgRole | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  return (data?.role as OrgRole) ?? null;
}
```

Save this as `src/lib/orgMembership.ts`.

- [ ] **Step 2: Refactor `src/app/layout.tsx`**

Replace:

```tsx
  let isOrgMember = false;
  if (user) {
    const { data: membership } = await supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    isOrgMember = !!membership;
  }
```

with:

```tsx
  const membership = await getCurrentMembership(supabase, user?.id);
```

And update the `AppShell` prop from `isOrgMember={isOrgMember}` to `isOrgMember={!!membership}`.

Add the import: `import { getCurrentMembership } from "@/lib/orgMembership";`

- [ ] **Step 3: Refactor `src/app/admin/layout.tsx`**

Replace:

```tsx
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
```

with:

```tsx
  const membership = await getCurrentMembership(supabase, user.id);
```

Add the import: `import { getCurrentMembership } from "@/lib/orgMembership";`

The `if (!membership)` check below stays as-is (still works — `null` either way).

- [ ] **Step 4: Refactor `src/app/admin/page.tsx`**

Replace:

```tsx
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, organization:organizations(name)")
    .eq("user_id", user?.id ?? "")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return null; // admin/layout.tsx already handles the no-membership state.
  }

  const org = Array.isArray(membership.organization)
    ? membership.organization[0]
    : membership.organization;
```

with:

```tsx
  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership) {
    return null; // admin/layout.tsx already handles the no-membership state.
  }
```

Add the import: `import { getCurrentMembership } from "@/lib/orgMembership";`

Then update the two remaining references in the same file:
- `<h2 className="text-lg font-medium">{org?.name} — Locations</h2>` → `<h2 className="text-lg font-medium">{membership.orgName} — Locations</h2>`
- `.eq("org_id", membership.org_id)` → `.eq("org_id", membership.orgId)`
- `<input type="hidden" name="org_id" value={membership.org_id} />` → `<input type="hidden" name="org_id" value={membership.orgId} />`

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all 35 tests pass (this task adds none).

- [ ] **Step 6: Manually verify nothing broke**

The dev server should already be running (`.claude/launch.json` config `court-scheduler-dev`). In the browser:
- Visit `/` signed out and signed in — sidebar nav unchanged.
- Visit `/admin` — still shows "{org name} — Locations" and the locations list exactly as before.
- Visit `/admin/locations/[locationId]` — unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/orgMembership.ts src/app/layout.tsx src/app/admin/layout.tsx src/app/admin/page.tsx
git commit -m "Add shared org-membership helpers, refactor the three duplicated lookups"
```

---

### Task 4: Roster management — actions + `/admin/team` page + nav link

**Files:**
- Modify: `src/app/admin/actions.ts`
- Create: `src/app/admin/team/page.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `wouldRemoveLastOwner`, `isOwnerOrAdmin`, `type OrgRole` from `@/lib/orgRoles` (Task 2); `getCurrentMembership` from `@/lib/orgMembership` (Task 3); `lookup_user_id_by_email` RPC and `org_members update admin` policy from Task 1.
- Produces: server actions `addOrgMember(formData)`, `updateOrgMemberRole(formData)`, `removeOrgMember(formData)` exported from `@/app/admin/actions`; route `/admin/team`.

- [ ] **Step 1: Add the three server actions**

Add to `src/app/admin/actions.ts` (near the other exports; add `import { wouldRemoveLastOwner, type OrgRole } from "@/lib/orgRoles";` to the top of the file alongside the existing imports):

```ts
export async function addOrgMember(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const email = String(formData.get("email") || "").trim();
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";

  const supabase = await createClient();

  const { data: userId, error: lookupError } = await supabase.rpc("lookup_user_id_by_email", {
    lookup_email: email,
  });

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (!userId) {
    redirect(
      `/admin/team?add_error=${encodeURIComponent("No account found for that email — they'll need to sign up first.")}`
    );
  }

  const { error: insertError } = await supabase
    .from("org_members")
    .insert({ org_id: orgId, user_id: userId, role });

  if (insertError) {
    if (insertError.code === "23505") {
      redirect(`/admin/team?add_error=${encodeURIComponent("This person already has access.")}`);
    }
    throw new Error(insertError.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?member_added=1");
}

export async function updateOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  const { count: ownerCount } = await supabase
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");

  if (target && wouldRemoveLastOwner(ownerCount ?? 0, target.role as OrgRole)) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Can't change the club's last owner.")}`);
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?role_updated=1");
}

export async function removeOrgMember(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  const { count: ownerCount } = await supabase
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");

  if (target && wouldRemoveLastOwner(ownerCount ?? 0, target.role as OrgRole)) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Can't change the club's last owner.")}`);
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?member_removed=1");
}
```

- [ ] **Step 2: Create the `/admin/team` page**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isOwnerOrAdmin } from "@/lib/orgRoles";
import { addOrgMember, updateOrgMemberRole, removeOrgMember } from "@/app/admin/actions";
import SuccessBanner from "@/components/SuccessBanner";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    member_added?: string;
    role_updated?: string;
    member_removed?: string;
    add_error?: string;
    role_error?: string;
  }>;
}) {
  const { member_added, role_updated, member_removed, add_error, role_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership || !isOwnerOrAdmin(membership.role)) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-gray-600">
        You don&apos;t have access to manage this club&apos;s team.
      </div>
    );
  }

  const { data: memberRows } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", membership.orgId)
    .order("role");

  const userIds = (memberRows ?? []).map((m) => m.user_id);
  const { data: userRows } = userIds.length
    ? await supabase.from("users").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };

  const emailById = new Map((userRows ?? []).map((u) => [u.id, u.email]));

  return (
    <div>
      <Link href="/admin" className="text-sm underline">
        &larr; {membership.orgName}
      </Link>

      <h2 className="mt-4 text-lg font-medium">Team — {membership.orgName}</h2>

      {member_added && <SuccessBanner>Admin added.</SuccessBanner>}
      {role_updated && <SuccessBanner>Role updated.</SuccessBanner>}
      {member_removed && <SuccessBanner>Access removed.</SuccessBanner>}
      {add_error && <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800">{add_error}</p>}
      {role_error && <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800">{role_error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {(memberRows ?? []).map((member) => (
          <li
            key={member.user_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-300 px-4 py-3"
          >
            <span className="text-sm">{emailById.get(member.user_id) ?? member.user_id}</span>

            {member.role === "owner" ? (
              <span className="text-sm text-gray-600">Owner</span>
            ) : (
              <form action={updateOrgMemberRole} className="flex items-center gap-2">
                <input type="hidden" name="org_id" value={membership.orgId} />
                <input type="hidden" name="user_id" value={member.user_id} />
                <select name="role" defaultValue={member.role} className="rounded border px-2 py-1 text-sm">
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
                <button type="submit" className="text-xs underline">
                  Save
                </button>
              </form>
            )}

            <form action={removeOrgMember}>
              <input type="hidden" name="org_id" value={membership.orgId} />
              <input type="hidden" name="user_id" value={member.user_id} />
              <button type="submit" className="text-xs text-red-700 underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-sm font-medium">Add an admin</h3>
      <form action={addOrgMember} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="org_id" value={membership.orgId} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" name="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <select name="role" defaultValue="staff" className="rounded border px-3 py-2">
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        <button type="submit" className="mt-1 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Add
        </button>
      </form>
    </div>
  );
}
```

Save this as `src/app/admin/team/page.tsx`.

- [ ] **Step 3: Add the "Team" link to the admin dashboard**

In `src/app/admin/page.tsx`, add the import:

```tsx
import { isOwnerOrAdmin } from "@/lib/orgRoles";
```

And right after the `<h2>` heading line, add:

```tsx
      {isOwnerOrAdmin(membership.role) && (
        <Link href="/admin/team" className="mt-2 block w-fit text-sm underline">
          Team &rarr;
        </Link>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify end-to-end in the browser**

Signed in as the existing owner account (`bdfink.su@gmail.com`):
1. Visit `/admin` — confirm the new "Team →" link appears, click it.
2. On `/admin/team`, confirm the roster shows the owner row with a static "Owner" label (no role select) and a Remove button.
3. If you don't already have a second test account, sign up one at `/signup` with a throwaway email (in a private/incognito tab, or sign out first) — this account needs to exist in `public.users` for the add flow to find it.
4. Back as the owner on `/admin/team`: add that email as `staff`. Confirm "Admin added." and the new row appears.
5. Try adding `nobody-at-all@example.com` — confirm the "No account found..." error, no row added.
6. Try adding the same staff email again — confirm the "This person already has access." error.
7. Change the staff member's role to `admin`, confirm "Role updated.", then back to `staff`.
8. Click Remove on the staff member — confirm "Access removed." and the row disappears.
9. As the owner, try Remove on your own (sole-owner) row — confirm it's blocked with "Can't change the club's last owner."

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actions.ts "src/app/admin/team/page.tsx" src/app/admin/page.tsx
git commit -m "Add /admin/team roster management (add/change-role/remove by email)"
```

---

### Task 5: Staff-aware UI gating on the location admin page

**Files:**
- Modify: `src/app/admin/locations/[locationId]/page.tsx`

**Interfaces:**
- Consumes: `getRoleForOrg` from `@/lib/orgMembership` (Task 3), `isOwnerOrAdmin` from `@/lib/orgRoles` (Task 2).
- Produces: nothing new for later tasks — this is a leaf UI change.

- [ ] **Step 1: Select `org_id` on the location query and compute the role**

In `src/app/admin/locations/[locationId]/page.tsx`, change:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, timezone, postal_code, latitude, longitude, formatted_address")
    .eq("id", locationId)
    .single();
```

to:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, timezone, postal_code, latitude, longitude, formatted_address, org_id")
    .eq("id", locationId)
    .single();
```

Add imports:

```tsx
import { getRoleForOrg } from "@/lib/orgMembership";
import { isOwnerOrAdmin } from "@/lib/orgRoles";
```

Right after the `if (!location) { notFound(); }` block, add:

```tsx
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getRoleForOrg(supabase, user?.id, location.org_id);
  const canManage = role ? isOwnerOrAdmin(role) : false;
```

- [ ] **Step 2: Gate the "Edit location" disclosure**

Wrap the existing `<details className="mt-4" open={Boolean(location_saved)}>...</details>` block (the "Edit location" form) in `{canManage && (...)}`.

- [ ] **Step 3: Gate each court's "Edit court" disclosure**

Inside the `courts.map(...)` loop, wrap the existing `<details className="mt-3" open={court_saved === court.id}>...</details>` block (the "Edit court" form) in `{canManage && (...)}`. The court's name/status summary above it (the `<Link>` + status line + Deactivate/Activate button) stays visible either way — staff still navigates through it, and the existing "Deactivate/Activate" toggle is left as-is since the spec's capability table only calls out create/edit as admin-only, not the active/inactive toggle. Since `updateCourtActive` writes to `courts` and the RLS policy `courts update admin` (Task 1) is now admin-only, wrap the Deactivate/Activate `<form>` in `{canManage && (...)}` too, so staff isn't shown a button that would fail.

- [ ] **Step 4: Gate the "Add a court" form**

Wrap the existing `<h3 className="mt-8 text-sm font-medium">Add a court</h3>` and the `<form action={createCourt} ...>` block that follows it in `{canManage && (...)}`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manually verify in the browser**

Using the staff test account created in Task 4:
1. Sign in as staff, visit `/admin/locations/[locationId]` for the org they were added to.
2. Confirm "Edit location," each court's "Edit court," each court's Deactivate/Activate button, and "Add a court" are all hidden.
3. Confirm the courts list (names, status, links) is still visible and each court link works.
4. Click into a court — confirm Weekly Availability, Date Overrides, and Upcoming Bookings (cancel + edit config) all still work exactly as before.
5. Sign back in as the owner — confirm all the same elements are visible again (regression check).

- [ ] **Step 7: Verify RLS actually rejects a staff write, not just that the UI hides it**

The UI gating in this task is a courtesy — the real security boundary is the RLS policies from Task 1. Confirm that directly, since the hidden-UI path alone doesn't prove it. First get a real `location_id` to target:

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query('select id, name from locations limit 3');
  console.log(res.rows);
  await client.end();
});
"
```

Then, using the staff test account's own email/password from Task 4 and one of the location ids above, attempt a direct insert as that authenticated staff user (this talks to Supabase directly with the public anon key + a real session, the same way the browser would — it does not go through the Next.js app):

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: 'STAFF_TEST_ACCOUNT_EMAIL',
    password: 'STAFF_TEST_ACCOUNT_PASSWORD',
  });
  if (signInError) { console.error('sign-in failed:', signInError.message); return; }
  const { error } = await supabase.from('courts').insert({ location_id: 'A_LOCATION_ID_FROM_ABOVE', name: 'RLS test court' });
  console.log('insert result:', error ? \`rejected (expected): \${error.message}\` : 'UNEXPECTEDLY SUCCEEDED -- RLS is not enforcing this');
});
"
```

Substitute the staff test account's actual email/password (from when you signed it up in Task 4) and a real location id. Expected: `rejected (expected): ...` — a Postgres RLS/policy violation, not a successful insert.

- [ ] **Step 8: Commit**

```bash
git add "src/app/admin/locations/[locationId]/page.tsx"
git commit -m "Hide court/location create-and-edit UI from staff on the admin location page"
```

---

### Task 6: Status log update + final verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Update the status log**

In `CLAUDE.md`, find the existing unchecked bullet:

```
\- \[ ] Club admins, created in-app and distinguished from players -- ...
```

Immediately after it, add a new checked entry (matching the file's established "Superseded above" convention used throughout the log):

```markdown
- [x] Superseded above: club admins shipped. An org owner/admin can now grant an existing player account admin access by email at `/admin/team` (linked from `/admin`, owner/admin only), choosing `admin` or `staff` -- `owner` assignment stays out of scope, deferred to the separate `v2-org-creation-deferred` spec. Backed by three new server actions (`addOrgMember`, `updateOrgMemberRole`, `removeOrgMember` in `src/app/admin/actions.ts`) and a narrow `security definer` Postgres function, `lookup_user_id_by_email` (`supabase/migrations/0010_club_admin_roles.sql`), since the `users` table's own RLS only allows selecting your own row. `role` now actually gates something for the first time in this app: RLS on `locations`/`courts` writes was tightened from any org member to owner/admin only (`supabase/migrations/0010_club_admin_roles.sql`), while `availability_rules`/`slot_overrides`/`bookings` stay open to `staff` -- so a staff member can manage weekly hours, date overrides, and bookings, but not create/edit courts or locations. The admin location page (`/admin/locations/[locationId]`) hides those staff-restricted forms/buttons entirely rather than letting RLS reject a submission. A `wouldRemoveLastOwner` guard (`src/lib/orgRoles.ts`, built test-first -- `src/lib/orgRoles.test.ts`) blocks removing or demoting an org's last owner, since RLS alone can't express that. The org-membership lookup that was previously duplicated three ways (root layout, admin layout, admin dashboard) is now a shared `getCurrentMembership` helper (`src/lib/orgMembership.ts`), plus a new `getRoleForOrg` for pages that need the role for a *specific* org rather than the user's first membership. Manually verified end-to-end: added a real second account as staff, confirmed the "no account found" and "already has access" errors, changed and reverted a role, removed access, confirmed the last-owner removal is blocked, and confirmed the staff account sees a cut-down `/admin/locations/[locationId]` (no edit/add-court/add-location) while hours/overrides/bookings on the court page are unaffected.
```

- [ ] **Step 2: Run the full verification suite**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (35 total — 30 from before this plan, plus the 5 new `orgRoles` tests), no type errors.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Update status log: club admins shipped"
```
