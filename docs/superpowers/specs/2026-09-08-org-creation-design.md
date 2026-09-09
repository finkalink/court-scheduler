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
- No atomicity guarantee between the two inserts a self-serve creation performs (org row, then membership row) — see **Accepted risk** below. (An earlier draft of this spec described a "best-effort compensating cleanup" that would delete the org row if the second insert failed; a live probe found there is no DELETE policy on `organizations` for ordinary users, so that cleanup silently deletes zero rows. Removed from the design rather than shipped as dead code — see the Server actions section.)

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

### Security note: "zero members" is not the same as "brand new" (migration `0037`)

A second, deeper adversarial review found that migration `0036`'s fix, while correctly closing the original hole, was reasoning from a false premise: an org's member count going to zero is not proof it was *never* owned. `org_members.user_id references auth.users(id) on delete cascade`, so a sole owner deleting their own auth account silently empties the org with no attacker involved at all; separately, the existing `org_members delete admin` policy already lets any owner remove every member row, including their own. Confirmed live: draining a real, populated, active org's membership and then inserting a stranger as its new owner succeeded — not as a millisecond race, but as a standing, indefinite exposure for any org that ever loses its last member.

Fixed by tracking the actual invariant directly instead of inferring it from a count that can revert to zero: `organizations.ownership_claimed`, a boolean that starts `false` on every new org and is flipped to `true` — via an `after insert on org_members` trigger, so it can never be forgotten by app code or reset by later *member removal* — the instant any member is ever added. The `org_members` insert policy now checks this flag (readable to everyone anyway, since `organizations select all` is `using (true)` — org ids and names are not a secret, correcting an earlier wrong claim in this doc that they were "not enumerable") instead of a live member count. `org_has_members()` (0036) is superseded and dropped; nothing else referenced it.

**A third adversarial review found the flag itself was not actually tamper-proof:** nothing pinned `ownership_claimed` against a direct `UPDATE`, so any existing org admin could flip it back to `false` on their own org via `organizations update admin` — reopening it to a takeover by an unrelated stranger, or, combined with self-demotion, letting an admin escalate to sole owner and evict the real owners (exactly the boundary `0029_owner_row_protection.sql` exists to defend, and the same bug class `0034` already had to fix once for `is_active` — on a column that didn't exist yet when `0034` was written, so its fix didn't and couldn't cover it). Confirmed live, on both variants, before being closed (migration `0038`) the same way `0034` closed it for `is_active`: pin `ownership_claimed` to its current stored value in that policy's `with_check` too. The same migration also tightened `"org_members insert self as first member"` to additionally require `not user_has_any_membership()` — an existing member could otherwise still claim ownership of any *other* unclaimed org (even a legitimately brand-new one that isn't theirs), a related but separate asymmetry the same review pointed out.

The same review flagged that `organizations insert self`'s own "no existing membership" check (0035) was a raw subquery on `org_members`, safe only because the rows it happens to need are exactly the rows that table's SELECT policy already exposes to the caller — fragile by the same shape that caused the original bug, one policy change away from silently breaking. Hardened with a `security definer` helper, `user_has_any_membership()`, matching `is_org_member`/`is_org_admin`'s own established pattern.

Also added: `"org_members select own"` (`using (user_id = auth.uid())`) — without it, `INSERT ... RETURNING` on the self-serve first-member insert 42501s even when the insert itself is fully permitted, because `RETURNING` re-applies the table's SELECT policy against a snapshot that can't see the row the same statement is still inserting. The reference server-action code in this spec never chains `.select()` on that particular insert, so this wasn't live-breaking, but it was a sharp latent trap for any future change that did.

### Accepted risk: creation-time window (narrowed to just that)

With both fixes above (the trigger-set flag, and pinning it against direct tampering), the only remaining gap is the genuine creation-time one: the few milliseconds between the `organizations` insert committing (`ownership_claimed = false`) and the `org_members` insert committing (which flips it to `true` via the trigger). During that window, the org is claimable by anyone who submits an `org_members` insert for that exact id first, and (per the fix above) the flag cannot be reopened afterward by any legitimate org admin's own action — only by never being set in the first place. Applies to both paths (an admin-assisted org is `is_active = true`, so a successful race there hands the racer an immediately-public, still location/court-empty club). Accepted as a low-severity, low-likelihood timing race rather than justifying a transaction/RPC for it. There is no compensating cleanup on the failure path — see the Server actions section — the shell it would have deleted is inert and this was never the actual security boundary anyway.

### Accepted risk: one user can create more than one self-served org, no race required

A live probe found this doesn't need concurrency at all: a single bulk `INSERT` (e.g. `insert into organizations (name, is_active) values (...), (...), (...)`) creates N org rows in one statement, all passing `organizations insert self`'s check identically, since none of them touch `org_members` — then a second bulk statement makes the caller `owner` of all N. This is a spam/row-growth vector bounded only by request size, not a two-request race as an earlier draft of this doc claimed. Still accepted as low severity — this codebase's own `createOrganization` server action only ever sends one row per request, so exploiting this requires bypassing the app and hand-crafting a raw PostgREST request; every resulting shell is `is_active = false` and dataless, with no privilege or data exposure. Closing it properly would need either a statement-level row-count trigger or per-user rate limiting, neither of which this feature's scope calls for.

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
    // No cleanup call here: ordinary users have no DELETE policy on
    // organizations, so a delete attempt would silently affect zero
    // rows. The orphaned org row is inert (is_active=false,
    // ownership_claimed=false, no locations/courts) and stays that way
    // unless someone else's own creation attempt happens to claim it --
    // see the spec's Accepted risk section.
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
    // Unlike createOrganization's self-serve path, this cleanup actually
    // works: the caller here is a platform admin, whose session has
    // DELETE on organizations via their own blanket ALL policy.
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
