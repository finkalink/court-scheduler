# Organization Creation — Design Spec

**Status:** Approved by the human partner in chat on 2026-09-08, following an in-chat design discussion (no separate visual-companion session was used).

## Problem

The data model has been multi-tenant since v1 (`organizations → locations → courts`), and the platform-admin tier (shipped 2026-09-08) already has full moderation support for organizations via `organizations.is_active`. But there is currently no way to create a new organization through the app at all — the live database has exactly one org ("Ace Volleyball Club"), and onboarding a second real club today means running SQL by hand against the production database. `/site-admin/orgs` only lists and activates/deactivates organizations that already exist.

## Goal

Two ways to create an organization, both enforced entirely through RLS (this codebase's established, sole authorization mechanism — no app-level role checks):

1. **Self-serve** — any signed-in user with a complete profile can create their own club.
2. **Admin-assisted** — a platform admin creates a club shell and assigns an existing user as its owner in one step.

## Non-goals

- No approval *workflow* (no email notifications, no queue UI beyond the existing `is_active` toggle already on `/site-admin/orgs`).
- No support for a user creating more than one org via self-serve in the same session/account (see Role model below) — an admin can still make a user own more than one org via the admin-assisted path.
- No first-location/first-court creation bundled into org creation — the org starts empty; the existing "Add a location" flow on `/admin` handles that immediately afterward.
- No Stripe/payment integration (that's v4, unrelated to this feature; `organizations.stripe_account_id` stays untouched).
- No atomicity guarantee between the two inserts a self-serve creation performs (org row, then membership row) beyond a best-effort compensating cleanup — see **Accepted risk** below.

## Role model

| Path | Who can trigger it | Resulting org state | Resulting membership |
|---|---|---|---|
| Self-serve | Any signed-in user with a complete profile (`isProfileComplete`) who does not already belong to any org | `is_active = false` (pending review) | Creator becomes `org_members.role = 'owner'` |
| Admin-assisted | A platform admin (`is_platform_admin()`) | `is_active = true` (pre-vetted by the admin) | The looked-up user becomes `org_members.role = 'owner'` directly — no separate "transfer" step |

A self-serve creator who already belongs to an org is blocked both in the UI (the entry point only renders for a user with no membership — see Entry points) and in RLS (defense in depth — see below), so this is not just a UI-level assumption.

## RLS changes (migration `0035_org_creation.sql`)

Current state (verified against the live database before writing this spec): `organizations` has no INSERT policy for ordinary users at all — only the platform-admin `ALL` policy permits INSERT today. `org_members` has an INSERT policy (`org_members insert admin`) that requires the actor already be an admin of that org, which is circular for a brand-new org with zero members.

Two new, additive policies:

```sql
create policy "organizations insert self" on organizations
  for insert
  with check (
    is_active = false
    and not exists (select 1 from org_members where user_id = auth.uid())
  );

create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (select 1 from org_members m where m.org_id = org_members.org_id)
  );
```

Permissive Postgres RLS policies for the same command are OR'd together (this codebase's established pattern — see `0032_platform_admin.sql`'s comment on the same point), so:

- A platform admin's existing `ALL` policies on both tables already permit the admin-assisted path (insert an org with `is_active = true`, insert a membership row for an arbitrary user) — **no new policy is needed for that path.**
- An ordinary self-serve user is permitted by the two new policies above, and only within their exact constraints: they cannot self-grant `is_active = true`, cannot create a second org while already a member of one, and cannot insert an `org_members` row claiming ownership of an org that already has a member (i.e. cannot take over an existing club).

### Security note: `org_members`'s "zero members" check must not be a raw policy subquery

An adversarial review of the first draft of this migration found a critical hole: writing the "zero members" guard as a plain `not exists (select 1 from org_members m where m.org_id = org_members.org_id)` gets evaluated *through `org_members`'s own SELECT policy* (`using (is_org_member(org_id))`), which a non-member can't see past — making the check read "zero members" for **every org the attacker doesn't belong to**, not just genuinely empty ones. Confirmed live: an ordinary signed-in user could `INSERT` themselves as `owner` of the existing, populated, active "Ace Volleyball Club" org. Fixed (migration `0036`) with a `security definer` helper function, `org_has_members(uuid)` — the exact pattern `is_org_member`/`is_org_admin` already use in `0002_rls.sql` for this identical class of hazard (a `security definer` function runs with its owner's privileges, so it sees the real row count regardless of the caller's own RLS visibility). Any future policy on `org_members` (or any table) that needs to check that table's own rows from inside that table's own policy must use a `security definer` function, never a bare subquery — this is now the second time this exact mistake has been made and caught in this codebase (see `0002_rls.sql`'s comment predicting it).

### Accepted risk: non-atomic two-step insert (narrowed after the fix above)

Also corrected: `organizations select all` is `using (true)` — every org's id and name are already public to any signed-in *or anonymous* request. Org ids are not a secret; the earlier draft's "not enumerable" claim was wrong.

Both creation paths are two separate `INSERT` statements from the server action (organizations, then org_members), not one atomic transaction. With the fix above, `org_has_members` correctly reports the org's *true* member count regardless of who's asking — so the only remaining window is the genuine one: the few milliseconds between the `organizations` insert committing and the `org_members` insert committing, during which that specific org really does have zero members and is briefly claimable by anyone who submits an `org_members` insert for that exact id first. This applies to **both** paths now, not just self-serve — an admin-assisted org is created `is_active = true`, so a successful race there hands the racer ownership of an immediately-public (though still location/court-empty) club, not just an inactive shell. This is accepted as a low-severity, low-likelihood timing race (an attacker would need to observe or guess a freshly-minted UUID within a network-latency-sized window, then win a race against the legitimate request's own second insert) rather than justifying a database transaction/RPC for it. The implementation still includes a best-effort compensating cleanup (delete the org row if the membership insert fails) to shrink the window on the *failure* path, but this was never a security boundary and still isn't.

### Accepted risk: one user can end up owning more than one self-served org

The `organizations insert self` policy's "no existing membership" guard only sees *committed* memberships, which don't exist yet mid-creation — so two overlapping self-serve creation attempts from the same user (both `organizations` inserts landing before either `org_members` insert does) can both succeed, defeating the Non-goal's intent of "one self-serve org per user." A hard guarantee would need either a serializable transaction/advisory lock, or a unique constraint on `org_members` scoped to owners — the latter would also block the admin-assisted path's explicit, wanted flexibility ("an admin can still make a user own more than one org"), so it's not a clean fix. Accepted as low severity: the only outcome is one user ending up with two empty, inactive, dataless shells instead of being blocked from creating the second — no privilege or data exposure, unlike the finding above.

## Server actions

### `createOrganization` (self-serve) — new, in `src/app/admin/actions.ts`

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
    await supabase.from("organizations").delete().eq("id", org.id); // best-effort cleanup, see spec's Accepted risk
    redirect(`/create-club?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/admin");
  redirect("/admin?club_created=1");
}
```

### `createOrganizationForUser` (admin-assisted) — new, in `src/app/site-admin/actions.ts`

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

Both actions do zero manual role/permission checks in app code — matching every existing action in `admin/actions.ts` and `site-admin/actions.ts` — RLS is what actually decides whether either insert succeeds.

## Pages

### `src/app/create-club/page.tsx` — new

**Deliberately NOT nested under `/admin`.** `src/app/admin/layout.tsx` only renders `children` when the signed-in user already has a membership — it renders its own "not a member" fallback and returns early otherwise. A page for users who do *not* have a membership yet cannot live inside that subtree without first restructuring the layout's gate (out of scope — every other page under `/admin/*` correctly relies on that gate, and loosening it is a bigger, riskier change than this feature needs). A standalone top-level route sidesteps the conflict entirely.

A small form: club name only. Reachable only from the "not a member" state in `src/app/admin/layout.tsx` (see Entry points) — not linked from primary nav, since it's a rare, one-time action, not a browsing destination. Gated the same way event registration already gates on profile completeness (`isProfileComplete`): if the signed-in user's profile is incomplete, show the existing "complete your profile first" message-plus-link pattern instead of the form (reuse, don't reinvent). Also redirects to `/login?next=/create-club` if signed out, and to `/admin` (no error) if the signed-in user already has a membership — the RLS check would reject the insert anyway, so this is purely a friendlier UX short-circuit, not a security boundary.

### `src/app/site-admin/orgs/new/page.tsx` — new

A small form: club name + owner's email. Gated the same way every other `/site-admin/*` page already gates (`getIsPlatformAdmin` check, same "You don't have access to site admin." fallback text used verbatim elsewhere).

### `src/app/admin/layout.tsx` — modified

The existing "not a member" block gets a "Create a club" link to `/create-club`, and — since a self-serve creator lands back in `/admin` immediately — the pending-review banner lives on `/admin/page.tsx` instead (see below), not here.

### `src/app/admin/page.tsx` — modified

When the signed-in user's org has `is_active = false`, show a status-style banner near the top: "This club is pending review by a platform admin. You can set up locations and courts now — it won't be visible to players until it's approved." Uses the existing `bg-status`/`text-status-fg` tokens (the same ones used for the homepage's event-type pill and the admin sub-nav's active-tab styling) — no new token needed.

### `src/app/site-admin/orgs/page.tsx` — modified

Add an "Add organization" link at the top, to `/site-admin/orgs/new`. No other change — the existing Active/Inactive toggle is exactly the "review and approve" mechanism a newly-self-served pending org needs; no separate "pending" visual state is introduced (an inactive org already reads as "Inactive" in the existing badge, which is accurate).

## Testing

- Unit: no new pure-function logic to unit test (the two new pages/actions are thin: a form and a database insert, same shape as every other admin CRUD action in this codebase, none of which have dedicated unit tests beyond the occasional component test).
- Manual, live-session verification (no superuser/service-role bypass, matching this codebase's established RLS-testing convention — generate a real session via the Supabase Admin API's `generateLink`/`verifyOtp` flow, no password ever typed):
  1. A fresh signed-in test account with a complete profile can create a club via `/create-club`; the resulting org has `is_active = false`; the creator can immediately see and use `/admin` for that org (add a location, etc.); the pending-review banner renders.
  2. The exact same account, now a member, cannot reach `/create-club` again in a way that succeeds (RLS rejects a second self-serve `organizations` insert for a user who already has a membership row) — confirms the defense-in-depth check, not just the UI gate.
  3. A different real account attempts to `INSERT` into `org_members` claiming ownership of the *first* account's now-non-empty org — rejected (confirms the "zero members" check actually blocks a takeover of an existing club, not just a hypothetical one).
  4. A platform-admin session creates an org via `/site-admin/orgs/new` for a third, already-existing test user's email; the resulting org is immediately `is_active = true`; that third user can access `/admin` for it as owner without ever touching `/site-admin/orgs/new` themselves.
  5. The admin-assisted form rejects an email with no matching user, with a friendly message, not a raw error.
