# Organization Creation Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Each task is a self-contained commit with its own tests where applicable. Run `npm test` after each task.

**Goal:** Two ways to create an organization — self-serve (any signed-in, profile-complete user with no existing membership) and admin-assisted (a platform admin assigns an existing user as owner directly) — both enforced entirely through new RLS policies, matching this codebase's sole-authorization-layer convention.

**Architecture:** One additive migration (two new INSERT policies, no changes to existing policies). Two new thin server actions, each mirroring the existing action style in their respective `actions.ts` files exactly (no manual role checks — RLS decides). Two new pages: `src/app/create-club/page.tsx` (deliberately outside `/admin`, since `admin/layout.tsx`'s membership gate would make an `/admin/*` route unreachable for the exact users this page is for) and `src/app/site-admin/orgs/new/page.tsx`. Two small existing-page edits (`admin/layout.tsx` gets a link, `admin/page.tsx` gets a pending-review banner, `site-admin/orgs/page.tsx` gets a link).

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres/RLS.

**Spec:** `docs/superpowers/specs/2026-09-08-org-creation-design.md` — read it in full before starting; it has the exact RLS policy SQL, the exact server-action code, and the accepted-risk reasoning for the non-atomic two-insert flow. This plan's tasks implement that spec verbatim; where this plan's code differs from the spec's illustrative snippets in a trivial way (formatting, exact variable names), the spec's *intent* governs.

## Global Constraints

- No new dependencies.
- No manual app-level role/permission checks in either new server action — RLS is the only enforcement layer, matching every existing action in `src/app/admin/actions.ts` and `src/app/site-admin/actions.ts`.
- No new CSS tokens — reuse `bg-status`/`text-status-fg` for the pending-review banner (same tokens already used for the homepage's event-type pill and the admin sub-nav's active-tab styling) and `buttonClass` for buttons/links that submit or commit.
- Every RLS policy added must be additive (`create policy ...`) — do not drop or modify any existing policy.
- The self-serve path's `organizations` INSERT must be rejected outright (not just hidden in the UI) for: (a) a request setting `is_active = true`, (b) a request from a user who already has an `org_members` row. Both are RLS `with check` conditions, not app-code checks — see the spec's exact SQL.
- The `org_members` self-insert-as-owner policy must be rejected outright for any org that already has at least one member — this is what stops a stranger from claiming an existing club.
- Manual live-session verification (Task 4) must use a real Supabase session generated via the Admin API's `generateLink`/`verifyOtp` flow (no password ever typed, no `DATABASE_URL`/service-role bypass for the actual permission checks) — this codebase's established, non-negotiable convention for testing RLS, documented in `docs/STATUS.md`'s prior incidents. `DATABASE_URL` may be used only for read-only setup/inspection (e.g. checking which test accounts exist), never to stand in for the access-control test itself.

## Task 1: RLS migration

**Files:**
- Create: `supabase/migrations/0035_org_creation.sql`

**Interfaces:**
- Produces: two new policies, `"organizations insert self"` on `organizations` and `"org_members insert self as first member"` on `org_members`. No functions, no schema changes.

- [ ] **Step 1: Write the migration**

```sql
-- Lets a signed-in user create their own organization (self-serve club
-- signup), scoped tightly: they cannot self-activate it, and cannot do
-- this if they already belong to any org. Platform admins already have
-- an unconditional ALL policy on this table (0032_platform_admin.sql)
-- that permits the admin-assisted path with no change needed here --
-- permissive RLS policies for the same command are OR'd together.
create policy "organizations insert self" on organizations
  for insert
  with check (
    is_active = false
    and not exists (select 1 from org_members where user_id = auth.uid())
  );

-- Lets a user insert themselves as the owner of a brand-new org --
-- but only while that org still has zero members, which is what stops
-- this from being usable to claim an existing club. Platform admins
-- already have an unconditional ALL policy on this table too.
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (select 1 from org_members m where m.org_id = org_members.org_id)
  );
```

- [ ] **Step 2: Apply it to the live Supabase project**

Run: `npm run migrate` (this project's existing migration runner — check `package.json`'s `scripts.migrate` for the exact invocation if unfamiliar; every prior migration in this repo was applied this way, not by hand in the SQL editor, unless a prior STATUS.md entry says otherwise for that one migration).

- [ ] **Step 3: Verify the policies exist**

Run a read-only query against `pg_policies` (via `DATABASE_URL`, read-only inspection is fine here — this is not the access-control test itself) filtering `tablename in ('organizations','org_members')` and confirm both new policy names appear with the exact `with_check` clauses above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_org_creation.sql
git commit -m "Add RLS policies for self-serve organization creation"
```

**Addendum (found by the Task 1 review, fixed in migration `0036_fix_org_takeover.sql`):** the `"org_members insert self as first member"` policy's "zero members" check must not be a raw subquery on `org_members` itself — it gets filtered through that table's own SELECT policy (`is_org_member`), so it reads "zero members" for every org a non-member can't see, not just genuinely empty ones. This let any signed-in user insert themselves as `owner` of an existing, populated club. Fixed with a `security definer` helper, `org_has_members(uuid)`, matching `is_org_member`/`is_org_admin`'s own established pattern in `0002_rls.sql` for this exact hazard. See the spec's "Security note" section for the full writeup. Confirmed live: the takeover is blocked (`42501`) and the legitimate self-serve happy path still succeeds.

## Task 2: Self-serve creation — action + page

**Files:**
- Modify: `src/app/admin/actions.ts` (add `createOrganization`)
- Create: `src/app/create-club/page.tsx`

**Interfaces:**
- Consumes: `isProfileComplete` from `@/lib/userProfile`, `buttonClass` from `@/lib/buttonStyles`, `createClient` from `@/lib/supabase/server`, `getCurrentMembership` from `@/lib/orgMembership`.
- Produces: `createOrganization(formData: FormData)` — a server action taking a `name` field. On success, redirects to `/admin?club_created=1`. On any failure, redirects back to `/create-club?error=<message>`.

- [ ] **Step 1: Add the server action**

In `src/app/admin/actions.ts`, add (matching this file's existing imports — it already imports `redirect`, `revalidatePath`, `createClient`):

```ts
export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    redirect(`/create-club?error=${encodeURIComponent("Club name is required.")}`);
  }

  const supabase = await createClient();
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, is_active: false })
    .select("id")
    .single();

  if (orgError || !org) {
    redirect(`/create-club?error=${encodeURIComponent(orgError?.message ?? "Couldn't create the club.")}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: memberError } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: user!.id, role: "owner" });

  if (memberError) {
    await supabase.from("organizations").delete().eq("id", org.id);
    redirect(`/create-club?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/admin");
  redirect("/admin?club_created=1");
}
```

- [ ] **Step 2: Create the page**

```tsx
// src/app/create-club/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isProfileComplete } from "@/lib/userProfile";
import { createOrganization } from "@/app/admin/actions";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Create a Club" };

export default async function CreateClubPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/create-club");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (membership) {
    redirect("/admin");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("name, gender, skill_level")
    .eq("id", user.id)
    .maybeSingle();

  const profileIncomplete = !profile || !isProfileComplete(profile);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">
        Create a Club<span className="text-accent">.</span>
      </h1>

      {profileIncomplete ? (
        <p className="mt-4 text-sm">
          Complete your profile before creating a club.{" "}
          <Link href={`/profile?next=${encodeURIComponent("/create-club")}`} className="underline">
            Complete your profile
          </Link>
        </p>
      ) : (
        <>
          {error && (
            <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">{error}</p>
          )}
          <form action={createOrganization} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Club name
              <input name="name" required className="rounded border border-border px-3 py-2" />
            </label>
            <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
              Create club
            </button>
          </form>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. (No new unit tests — this is a thin form + insert, same shape as every other admin CRUD action in this codebase; Task 4 covers real verification.)

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actions.ts src/app/create-club/page.tsx
git commit -m "Add self-serve club creation"
```

## Task 3: Admin-assisted creation — action + page

**Files:**
- Modify: `src/app/site-admin/actions.ts` (add `createOrganizationForUser`)
- Create: `src/app/site-admin/orgs/new/page.tsx`

**Interfaces:**
- Produces: `createOrganizationForUser(formData: FormData)` — a server action taking `name` and `owner_email` fields. On success, redirects to `/site-admin/orgs?club_created=1`. On any failure, redirects back to `/site-admin/orgs/new?error=<message>`.

- [ ] **Step 1: Add the server action**

In `src/app/site-admin/actions.ts` (already imports `revalidatePath`, `createClient` — this file does not currently import `redirect`, add it):

```ts
export async function createOrganizationForUser(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("owner_email") || "").trim().toLowerCase();

  if (!name || !email) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Club name and owner email are both required.")}`);
  }

  const supabase = await createClient();

  const { data: owner } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!owner) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent(`No user found with email "${email}".`)}`);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, is_active: true })
    .select("id")
    .single();

  if (orgError || !org) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent(orgError?.message ?? "Couldn't create the club.")}`);
  }

  const { error: memberError } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: owner!.id, role: "owner" });

  if (memberError) {
    await supabase.from("organizations").delete().eq("id", org.id);
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/site-admin/orgs");
  redirect("/site-admin/orgs?club_created=1");
}
```

- [ ] **Step 2: Create the page**

Match the existing gate pattern used verbatim in `src/app/site-admin/orgs/page.tsx` (read that file first for the exact `getIsPlatformAdmin` check and the "You don't have access to site admin." fallback markup — copy it exactly, don't paraphrase it differently).

```tsx
// src/app/site-admin/orgs/new/page.tsx
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { createOrganizationForUser } from "@/app/site-admin/actions";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Add Organization" };

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Add Organization</h1>

      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">{error}</p>
      )}

      <form action={createOrganizationForUser} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Club name
          <input name="name" required className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Owner&apos;s email
          <input
            name="owner_email"
            type="email"
            required
            className="rounded border border-border px-3 py-2"
          />
          <span className="text-xs text-fg-muted">Must be an existing user's account email.</span>
        </label>
        <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
          Create organization
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/site-admin/actions.ts src/app/site-admin/orgs/new/page.tsx
git commit -m "Add admin-assisted club creation"
```

## Task 4: Entry points, pending-review banner, and live RLS verification

**Files:**
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/site-admin/orgs/page.tsx`

**Interfaces:** None new — wiring existing pieces together, plus the manual verification pass.

- [ ] **Step 1: Add the "Create a club" link to `admin/layout.tsx`**

Find the existing "not a member" block:

```tsx
if (!membership) {
  return (
    <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
      Your account ({user.email}) isn&apos;t a member of any organization.
    </div>
  );
}
```

Add a link inside it:

```tsx
if (!membership) {
  return (
    <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
      <p>Your account ({user.email}) isn&apos;t a member of any organization.</p>
      <a href="/create-club" className={`mt-4 inline-block ${buttonClass("primary")}`}>
        Create a club
      </a>
    </div>
  );
}
```

Add `import { buttonClass } from "@/lib/buttonStyles";` to this file. Use a plain `<a>`, not `next/link`'s `<Link>` — check this file's existing imports first; if it doesn't already import `Link` there's no reason to add it for one internal link, but if it's simple to add `Link` instead for client-side navigation, that's fine too — either is acceptable here, this isn't a hot navigation path.

- [ ] **Step 2: Add the pending-review banner to `admin/page.tsx`**

This page already fetches `org` (currently just `select("venmo_handle")`). Extend that select to also fetch `is_active`:

```tsx
const { data: org } = await supabase
  .from("organizations")
  .select("venmo_handle, is_active")
  .eq("id", membership.orgId)
  .single();
```

Add a banner right after the `<h1>`:

```tsx
{org && !org.is_active && (
  <p className="mt-4 rounded bg-status p-3 text-sm text-status-fg">
    This club is pending review by a platform admin. You can set up locations and courts
    now — it won&apos;t be visible to players until it&apos;s approved.
  </p>
)}
```

- [ ] **Step 3: Add the "Add organization" link to `site-admin/orgs/page.tsx`**

Near the `<h1>Organizations</h1>`, add:

```tsx
<a href="/site-admin/orgs/new" className={`mt-2 inline-block ${buttonClass("primary")}`}>
  Add organization
</a>
```

Add the `buttonClass` import to this file if not already present.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/layout.tsx src/app/admin/page.tsx src/app/site-admin/orgs/page.tsx
git commit -m "Wire up entry points and pending-review banner for club creation"
```

- [ ] **Step 6: Manual live-session verification**

Run the dev server from this worktree. Using the Supabase Admin API's `generateLink({ type: "magiclink", email })` + `verifyOtp` technique (service-role key used only to *generate* the link, never to bypass RLS on the actual test calls — this mirrors every prior RLS verification in this codebase's history) against real, disposable test accounts, verify all five scenarios in the spec's Testing section:

1. A profile-complete test account creates a club via `/create-club`; confirm via a real PostgREST `select` (using that account's own access token) that the resulting org row has `is_active = false`; confirm the account can immediately use `/admin` for it (e.g. add a location).
2. The same account attempts a second `organizations` insert directly via PostgREST (simulating a repeat/bypassed-UI attempt) — confirm it's rejected with `42501`, not silently allowed.
3. A second, different test account attempts to `insert` into `org_members` claiming `role: 'owner'` for the first account's now-non-empty org — confirm `42501`.
4. A real platform-admin session (an existing, already-verified platform admin account — do not grant platform-admin to a fresh account for this, reuse the bootstrap account) creates a club via `/site-admin/orgs/new` for a third test account's email; confirm the resulting org is `is_active = true` immediately, and that the third account can access `/admin` for it without ever visiting `/site-admin/orgs/new` itself.
5. Submit `/site-admin/orgs/new` with an email that matches no user — confirm the friendly "No user found" message renders, not a raw 500.

Delete/deactivate every test account and test org created during this verification afterward, and delete any scratch `.mjs` verification scripts before finishing — matching this codebase's established cleanup convention.

## Final Check

- [ ] `npm test` — full suite green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean.
- [ ] All 5 manual verification scenarios from Task 4 Step 6 passed, using real sessions, not `DATABASE_URL`/service-role bypass for the actual access-control assertions.
- [ ] No test accounts, test orgs, or scratch scripts left behind from verification.
