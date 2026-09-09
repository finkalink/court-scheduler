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
- Create: `supabase/migrations/0035_org_creation.sql` (the original, broken draft — see Addenda 1-4 below; also `0036`, `0037`, `0038`, `0039`, `0040`, all created and applied during this task's own review loop, not as separate later tasks)

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

**Addendum 1 (found by the Task 1 review, fixed in migration `0036_fix_org_takeover.sql`):** the `"org_members insert self as first member"` policy's "zero members" check must not be a raw subquery on `org_members` itself — it gets filtered through that table's own SELECT policy (`is_org_member`), so it reads "zero members" for every org a non-member can't see, not just genuinely empty ones. This let any signed-in user insert themselves as `owner` of an existing, populated club. Fixed with a `security definer` helper, `org_has_members(uuid)`, matching `is_org_member`/`is_org_admin`'s own established pattern in `0002_rls.sql` for this exact hazard.

**Addendum 2 (found by a second adversarial review, fixed in migration `0037_fix_zero_members_unsound.sql`, which supersedes Addendum 1's helper):** "zero members" was itself the wrong invariant — an org can legitimately reach zero members long after creation (`org_members.user_id` cascades on `auth.users` deletion; an owner can also drain every member via the existing `org_members delete admin` policy), making any such org claimable again by member removal alone. Fixed by tracking a durable `organizations.ownership_claimed` flag, set via an `after insert on org_members` trigger (so it can't be forgotten by app code or reset by later member removal), checked instead of any member count. The same review also hardened `organizations insert self`'s own membership check with a new `user_has_any_membership()` helper (same fragile-subquery shape as the original bug, safe only by accident) and added an `"org_members select own"` policy to prevent a latent `INSERT ... RETURNING` trap. Confirmed live, with a corrected test script after an initial false alarm from testing against the platform-admin bootstrap account by accident: the drain-then-claim takeover is blocked (`42501`), an already-claimed org stays unclaimable after losing every member, and the legitimate self-serve happy path — including `INSERT ... RETURNING` — still succeeds.

**Addendum 3 (found by a THIRD adversarial review, fixed in migration `0038_pin_ownership_claimed.sql`):** Addendum 2's flag was durable against member removal but not against being set directly — nothing pinned `ownership_claimed` in `"organizations update admin"`'s `with_check`, the same gap `0034` had already fixed once for `is_active`, just on a column that didn't exist when `0034` was written. Any org admin could `UPDATE` their own org's `ownership_claimed` back to `false`, reopening it to a takeover by a stranger, or — combined with self-demotion — escalate themselves from admin to sole owner and evict the real owners, exactly the boundary `0029_owner_row_protection.sql` exists to defend. Confirmed live on both variants before being closed the same way `0034` closed it: pin the column to its current stored value, same as `is_active`. The same migration also tightened `"org_members insert self as first member"` to require `not user_has_any_membership()`, closing a related asymmetry (an existing member could otherwise still claim any *other* unclaimed org). Confirmed live: both attack variants now reject with `42501`, and the DB is unchanged. See the spec's third "Security note" subsection for the full writeup, and its "Accepted risk" sections (corrected in the same pass — a stated "best-effort compensating cleanup" in the self-serve path was found to be non-functional, since ordinary users have no DELETE policy on `organizations`, and was removed from that action's code; the admin-assisted path's own cleanup is genuinely functional, since a platform admin's session does have that DELETE access, and was kept).

**Addendum 4 (found by a fourth adversarial review, run specifically to confirm Addendum 3's fix held up, fixed in migration `0039_require_authenticated_for_org_insert.sql`):** `"organizations insert self"` never required `auth.uid() is not null`. With no session at all (the `anon` role), `user_has_any_membership()` returns `false` and the rest of the check passed, letting an anonymous, unauthenticated request insert `organizations` rows. Bounded (the rows are inert and `anon` can never insert `org_members` to claim one), but no reason to allow it. Confirmed live: `anon` now rejects with `42501`; the authenticated happy path is unaffected. This fourth review round otherwise came back clean — genuinely nothing else found after real effort, reported plainly rather than manufacturing a fifth finding to seem thorough.

**This migration survived four real, live-confirmed findings across four adversarial review rounds before being trusted.** That is the process working as intended for a change to the two tables every other authorization boundary in this app is built on top of — not a sign the design was rushed. Task 2 proceeded only once a review round came back with no further findings.

**Addendum 5 (found by the FINAL whole-branch review, after Tasks 2-4 were also complete, fixed in migration `0040_org_creation_final_review_fixes.sql`):** looking at the completed feature as a whole (not one task's diff at a time) surfaced a fifth real RLS gap plus two smaller app-layer ones no single task's reviewer could have seen: (1) neither new insert policy called `is_current_user_active()` — established in `0032` for exactly this, applied to bookings/event registrations, never applied here — so a platform-admin-deactivated user could still self-serve create a pending org; (2) Task 3's `.ilike("email", ...)` lookup (added in its own earlier fix round) treated `%`/`_` as wildcards rather than literal characters, risking assignment to the wrong owner; (3) `createOrganization` (Task 2) dereferenced a possibly-null `user` with no guard and only gated on profile completeness in the page, unlike the identical established pattern in `registerForEvent`; neither creation path's success redirect was ever rendered as a confirmation banner; and the pending-review banner's wording was inaccurate for an org a platform admin deactivated for cause rather than one still awaiting its first review. All fixed in one bundled pass (per this process's "no second fix wave" rule) and confirmed live. See the spec's corresponding "Security note" subsections and its final "consolidated RLS" block for the version to actually use.

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
    // No cleanup here: ordinary users have no DELETE policy on
    // organizations, so this would silently affect zero rows. The
    // orphaned row is inert (is_active=false, ownership_claimed=false,
    // no locations/courts) -- see the spec's Accepted risk section.
    redirect(`/create-club?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/admin");
  redirect("/admin?club_created=1");
}
```

**Note (added by Addendum 5, after this task was already implemented and reviewed):** the shipped version of this action differs from the snippet above — it guards against a null `user`, re-checks `isProfileComplete` inside the action rather than trusting only the page's gate, and correctly `user.id` (not `user!.id`). The spec's own code sample was updated to match; this plan's snippet is left as originally written, as the historical record of what Task 2 was dispatched with — read the spec for the current version.

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
    // Unlike createOrganization's self-serve path, this cleanup works:
    // the caller here is a platform admin, whose session has DELETE on
    // organizations via their own blanket ALL policy.
    await supabase.from("organizations").delete().eq("id", org.id);
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/site-admin/orgs");
  redirect("/site-admin/orgs?club_created=1");
}
```

**Note (added by the Task 3 fix round, and by Addendum 5 afterward):** the shipped version differs from the snippet above in two ways: the email lookup checks its own `lookupError` before dereferencing `owner`, and escapes `%`/`_`/`\` before calling `.ilike()` so the match is a case-insensitive equals rather than a wildcard pattern (an unescaped `_` or `%` in a legitimate email could otherwise match a different account). Read the spec's final version for the current code.

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

- [x] `npm test` — full suite green (258 tests — 257 from the original plan plus one added during the final fix wave for the new success banner).
- [x] `npx tsc --noEmit` — clean.
- [x] `npm run lint` — clean (one pre-existing, unrelated warning in `src/lib/email.ts`).
- [x] All 7 manual verification scenarios from the spec's Testing section passed (5 original + 2 added by Addendum 5), using real sessions generated via the Supabase Admin API, not `DATABASE_URL`/service-role bypass for the actual access-control assertions.
- [x] No test accounts, test orgs, or scratch scripts left behind from verification.
- [x] Final whole-branch review (opus) — one bundled fix wave (migration `0040` plus five small app-layer/doc fixes), one scoped re-review, confirmed clean. See Addendum 5.
