# Team Roster Visibility & Membership Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any player see a team's roster, and require every new
self-formed-team roster spot to resolve to a real account — immediately
if the teammate is already registered, or via a pending invite claimed
at their first sign-in if not.

**Architecture:** One new nullable `invited_email` column on the
already-public-select `event_team_members` table, plus two narrow
`security definer` RPCs: `find_registered_user_by_email` (exact-match
lookup, used when a captain adds a teammate) and
`claim_pending_team_invites` (links pending spots to the caller's own
account, called on every sign-in — never at signup, since no
authenticated session exists yet at that point in this app's
email-confirmation-required flow). The captain-facing "add teammate"
form collects a name + email pair per slot; the lookup result decides
whether the insert links immediately or creates a pending spot. A new
player-facing "Rosters" section reads the same public data everyone
already could, just not yet surfaced.

**Tech Stack:** Next.js server components/actions, Supabase Postgres +
RLS.

**Spec:** `docs/superpowers/specs/2026-09-01-team-roster-visibility-design.md`

## Global Constraints

- No transactional email — a pending spot is surfaced only as a status
  label ("Pending"); nothing is ever emailed. The captain is responsible
  for telling that person, out of band, to sign up with the exact email
  entered.
- No player directory or name search — `find_registered_user_by_email`
  is exact-match only, never partial/fuzzy, and returns only an opaque
  `user_id` or nothing, never a list.
- `invited_email` is never selected or rendered by any player-facing
  query — only the two new RPCs (both `security definer`) and the
  existing org-side admin-assembly flow read it.
- No backfill of existing rosters — a pre-migration free-text-only row
  (neither `user_id` nor `invited_email` set) is left as-is and, since
  the UI can't distinguish it from a genuinely pending invite without
  reading `invited_email` (which it must never do), displays as
  "Pending" the same way a real pending spot does. A minor, accepted
  cosmetic imprecision for historical data only.
- No change to capacity/waitlist timing — a team's `event_registrations`
  row is still created, and still counts against capacity, as soon as
  the captain finishes team setup, regardless of pending roster spots.
- No self-removal for a newly-linked teammate, and no change to
  `event_team_members`'s existing delete policy (captain-or-org-member)
  — pre-existing gap, out of scope here.

---

### Task 1: Migration — `invited_email`, unique index, two RPCs

**Files:**
- Create: `supabase/migrations/0021_team_roster_invites.sql`

**Interfaces:**
- Produces: `event_team_members.invited_email` column;
  `public.find_registered_user_by_email(check_email text) returns uuid`;
  `public.claim_pending_team_invites() returns void` (both consumed by
  Tasks 2-3).

- [ ] **Step 1: Write the migration**

```sql
-- Team roster visibility & membership integrity. Layers on top of
-- event_teams/event_team_members (0017-0019). Every NEW roster spot
-- must resolve to a real account -- immediately (user_id) or eventually
-- (invited_email, claimed at the teammate's first sign-in). Pre-existing
-- free-text-only rows (neither column set) are left alone, no backfill.

alter table event_team_members add column invited_email text;

-- One pending invite per email at a time, app-wide -- keeps the
-- sign-in-time claim lookup a single unambiguous match.
create unique index event_team_members_invited_email_unique
  on event_team_members (invited_email)
  where invited_email is not null;

-- Exact-match lookup, callable by any authenticated user (not just org
-- members -- any player can be a team captain). Returns only an opaque
-- user_id for an email the caller already typed themselves; not a new
-- enumeration surface since it confirms/denies one specific email at a
-- time, never a list. security definer needed because users' own RLS
-- only allows selecting your own row.
create function public.find_registered_user_by_email(check_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from users where email = check_email;
$$;

grant execute on function public.find_registered_user_by_email(text) to authenticated;

-- Links any pending invite addressed to the CALLER's own verified email
-- to the caller's own account. Takes no parameters and never trusts a
-- client-supplied identity -- auth.uid()/auth.users only -- so a roster
-- spot can only ever be linked to the account that actually owns that
-- inbox. Called on every sign-in (src/app/actions/auth.ts), not at
-- signup: this app requires email confirmation before a session exists,
-- so signUp() has no authenticated caller to attribute a claim to yet.
create function public.claim_pending_team_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return;
  end if;

  update event_team_members
  set user_id = auth.uid(), invited_email = null
  where invited_email = v_email and user_id is null;
end;
$$;

grant execute on function public.claim_pending_team_invites() to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0021_team_roster_invites.sql`

- [ ] **Step 3: Verify against the live database**

Confirm the `invited_email` column exists and the partial unique index
rejects a second row with the same `invited_email` while allowing
multiple rows with `invited_email is null`. As any authenticated (non
org-member) test account, call `find_registered_user_by_email` with a
known existing user's email (expect that user's id back) and a
made-up email (expect `null`). Manually insert an `event_team_members`
row with `invited_email` set to a real test account's email and
`user_id` null, then call `claim_pending_team_invites()` as that
account and confirm the row's `user_id` gets set and `invited_email`
clears.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0021_team_roster_invites.sql
git commit -m "Add invited_email column and two team-roster RPCs"
```

---

### Task 2: Email-tied teammate registration

**Files:**
- Modify: `src/app/actions/events.ts`
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `find_registered_user_by_email` from Task 1.
- No new exports — extends `registerForEvent`'s existing form-data
  contract with new field names (`captain_display_name`,
  `teammate_name_1..5`, `teammate_email_1..5`, replacing the old
  `teammate_name` repeated field).

- [ ] **Step 1: Replace `registerForEvent`'s team-formation block**

In `src/app/actions/events.ts`, replace the whole
`registerForEvent` function with:

```ts
export async function registerForEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const captainDisplayName = String(formData.get("captain_display_name") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
  }

  const { data: event } = await supabase
    .from("events")
    .select("capacity, registration_mode, team_formation, status")
    .eq("id", eventId)
    .single();

  if (!event) {
    throw new Error("Event not found.");
  }

  if (event.status !== "published" && event.status !== "registration_open") {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Registration isn't open for this event.")}`);
  }

  if (event.registration_mode === "individual" && !displayName) {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Enter a display name.")}`);
  }

  let teamId: string | null = null;

  // Self-formed team registration: create the team + roster now. Every
  // other case (individual events, and admin-assembled team events) is a
  // plain individual sign-up -- the org builds teams later for the
  // admin-assembled case.
  if (event.registration_mode === "team" && event.team_formation === "self_formed") {
    if (!teamName) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent("Team name is required.")}`);
    }
    if (!captainDisplayName) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent("Enter your display name.")}`);
    }

    // Every teammate slot needs a name AND an email now -- every roster
    // spot must resolve to a real account, either immediately (an
    // existing account) or eventually (a pending invite claimed at
    // sign-in). Only one of the two filled in is a form mistake, not a
    // valid partial entry.
    const teammates: { name: string; email: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const name = String(formData.get(`teammate_name_${i}`) || "").trim();
      const email = String(formData.get(`teammate_email_${i}`) || "").trim();
      if (!name && !email) continue;
      if (!name || !email) {
        redirect(
          `/events/${eventId}?register_error=${encodeURIComponent(`Teammate ${i} needs both a name and an email.`)}`
        );
      }
      teammates.push({ name, email });
    }

    const { data: team, error: teamError } = await supabase
      .from("event_teams")
      .insert({ event_id: eventId, name: teamName, captain_user_id: user.id })
      .select("id")
      .single();

    if (teamError) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent(teamError.message)}`);
    }

    teamId = team.id;

    const { error: captainError } = await supabase
      .from("event_team_members")
      .insert({ team_id: teamId, user_id: user.id, display_name: captainDisplayName });

    let rosterErrorMessage: string | null = captainError ? "Couldn't add your roster. Try again." : null;

    if (!rosterErrorMessage) {
      for (const teammate of teammates) {
        const { data: matchedUserId, error: lookupError } = await supabase.rpc(
          "find_registered_user_by_email",
          { check_email: teammate.email }
        );
        if (lookupError) {
          throw new Error(lookupError.message);
        }

        const { error: teammateError } = await supabase.from("event_team_members").insert(
          matchedUserId
            ? { team_id: teamId, user_id: matchedUserId, display_name: teammate.name }
            : { team_id: teamId, invited_email: teammate.email, display_name: teammate.name }
        );

        if (teammateError) {
          rosterErrorMessage =
            teammateError.code === UNIQUE_VIOLATION
              ? `${teammate.email} already has a pending invite elsewhere.`
              : "Couldn't add your roster. Try again.";
          break;
        }
      }
    }

    if (rosterErrorMessage) {
      // Roll back the orphaned team row -- same pattern as
      // addEventSession's session/booking rollback in
      // src/app/admin/eventActions.ts: a team without its full roster is
      // meaningless, so don't leave it behind.
      await supabase.from("event_teams").delete().eq("id", teamId);
      redirect(`/events/${eventId}?register_error=${encodeURIComponent(rosterErrorMessage)}`);
    }
  }

  const { data: counts, error: countError } = await supabase
    .from("event_registration_counts")
    .select("status, count")
    .eq("event_id", eventId);

  if (countError) {
    throw new Error(countError.message);
  }

  const registeredCount = (counts ?? []).find((c) => c.status === "registered")?.count ?? 0;

  const status = determineRegistrationStatus(registeredCount, event.capacity);

  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
    display_name: teamId ? null : displayName || null,
  });

  if (error) {
    const message =
      error.code === UNIQUE_VIOLATION
        ? "You're already registered for this event."
        : error.message;
    redirect(`/events/${eventId}?register_error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect(`/events/${eventId}`);
}
```

(`cancelEventRegistration`, below it in the same file, is unchanged.)

- [ ] **Step 2: Update the self-formed team registration form**

In `src/app/events/[eventId]/page.tsx`, replace the team-formation
form block:

```tsx
{event.registration_mode === "team" && event.team_formation === "self_formed" ? (
  <form action={registerForEvent} className="flex flex-col gap-3">
    <input type="hidden" name="event_id" value={event.id} />
    <label className="flex flex-col gap-1 text-sm">
      Team name
      <input name="team_name" required className="rounded border px-3 py-2" />
    </label>
    <label className="flex flex-col gap-1 text-sm">
      Your display name (shown on the roster)
      <input name="captain_display_name" required className="rounded border px-3 py-2" />
    </label>
    <p className="text-xs text-gray-600 dark:text-neutral-400">
      Teammates (optional) -- each needs a name and their email. If they
      aren&apos;t registered yet, they&apos;ll show as &quot;Pending&quot;
      until they sign up with that exact email.
    </p>
    {[1, 2, 3, 4, 5].map((n) => (
      <div key={n} className="flex gap-2">
        <input
          name={`teammate_name_${n}`}
          placeholder={`Teammate ${n} name`}
          className="w-1/2 rounded border px-3 py-2 text-sm"
        />
        <input
          name={`teammate_email_${n}`}
          type="email"
          placeholder={`Teammate ${n} email`}
          className="w-1/2 rounded border px-3 py-2 text-sm"
        />
      </div>
    ))}
    <button
      type="submit"
      className="w-fit rounded bg-black px-4 py-2 text-sm text-white"
    >
      {isFull ? "Join Waitlist" : "Register Team"}
    </button>
  </form>
) : (
```

(The `) : (` on the last line reconnects to the existing individual-registration
form branch immediately below it — only the team-formation branch's JSX changes.)

- [ ] **Step 3: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same tests as before

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts "src/app/events/[eventId]/page.tsx"
git commit -m "Require an email per teammate, linking or inviting via find_registered_user_by_email"
```

---

### Task 3: Claim pending invites at sign-in

**Files:**
- Modify: `src/app/actions/auth.ts`

**Interfaces:**
- Consumes: `claim_pending_team_invites` from Task 1.

- [ ] **Step 1: Call the claim RPC right after a successful sign-in**

In `src/app/actions/auth.ts`, insert into `signIn`, immediately after
the existing error check and before the `next` redirect:

```ts
export async function signIn(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const next = String(formData.get("next") || "");

  const supabase = await createClient();
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  // Links any pending team-roster invites addressed to this exact email
  // to the now-authenticated account (supabase/migrations/0021_team_roster_invites.sql).
  // Can't happen at signUp instead -- no session exists yet at that
  // point in this app's email-confirmation-required flow. Harmless
  // no-op when nothing's pending.
  await supabase.rpc("claim_pending_team_invites");

  if (next) {
    redirect(next);
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  redirect(membership ? "/admin" : "/");
}
```

(`signUp` and `signOut`, elsewhere in the same file, are unchanged.)

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/auth.ts
git commit -m "Claim pending team-roster invites on sign-in"
```

---

### Task 4: Player-facing team rosters

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- No new exports — a new read-only section on the existing page.

- [ ] **Step 1: Query every team's roster for this event**

In `src/app/events/[eventId]/page.tsx`, add this query after the
existing `sessions` query/sort and before the `matches` query (runs
unconditionally, not gated behind `if (user)`, since rosters are visible
to every visitor per the spec, signed in or not):

```tsx
  const { data: teams } =
    event.registration_mode === "team"
      ? await supabase
          .from("event_teams")
          .select("id, name, members:event_team_members(id, display_name, user_id)")
          .eq("event_id", eventId)
          .order("name")
      : { data: null };
```

`invited_email` is deliberately not selected here — a roster spot's
`user_id` being null is enough to show "Pending" without ever exposing
the email itself (a genuinely-pending invite and a pre-migration
free-text-only row look identical this way, which is an accepted,
minor imprecision for historical data only — see this plan's Global
Constraints).

- [ ] **Step 2: Add the Rosters section**

Add this section right after the existing registration status block
(`{event.status !== "cancelled" && ( ... )}`) and before the `<h2>Sessions</h2>`
heading:

```tsx
      {event.registration_mode === "team" && teams && teams.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Rosters</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {teams.map((team) => (
              <li
                key={team.id}
                className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800"
              >
                <p className="text-sm font-medium">{team.name}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {team.members.map((m) => (
                    <li key={m.id} className="text-sm text-gray-600 dark:text-neutral-400">
                      {m.display_name}
                      {!m.user_id && <span className="ml-1 text-xs italic">(pending)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/events/[eventId]/page.tsx"
git commit -m "Show every team's roster on the player event detail page"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers
  schema/RPC-level checks).
- **Linked teammate:** as one signed-in test account, self-form a team
  for a `self_formed` team event, adding a second real signed-up test
  account as a teammate by name + their exact email. Confirm that
  teammate's `event_team_members` row gets `user_id` set immediately
  (no "pending").
- **Pending teammate:** in the same registration, add a teammate whose
  email doesn't match any account. Confirm the row is created with
  `invited_email` set and shows as "Pending" on both the admin view and
  the new player-facing Rosters section.
- **Collision:** attempt to invite that same not-yet-registered email to
  a second team (or twice in one form submission); confirm a friendly
  "already has a pending invite elsewhere" error, not a raw database
  error, and that the team creation rolls back cleanly (no orphaned
  team row).
- **Claim at sign-in:** sign up a brand-new account using the pending
  invite's exact email, confirm the email, then sign in. Confirm the
  roster spot's `user_id` is now set and `invited_email` is cleared, and
  that this did *not* happen merely from signing up (only from signing
  in) — check the roster before and after the sign-in step specifically.
- **Captain display name:** confirm the captain's own roster entry now
  requires and shows their typed display name, not their email, and
  that an existing pre-feature registration flow (individual event
  registration) is unaffected.
- **Roster visibility:** as a signed-out visitor (or a signed-in player
  registered for a *different* team), confirm the Rosters section shows
  every team's full membership for a team-mode event, including pending
  spots labeled, and confirm no email address ever appears anywhere on
  the page (view page source / network tab, not just the rendered UI).
- **Pre-existing data:** confirm a team registered before this migration
  (free-text-only members, no `user_id`, no `invited_email`) still
  renders on the Rosters section without erroring (shown as "Pending",
  per the accepted imprecision).
- Confirm individual-mode event registration (no team involved) is
  completely unaffected by any of the above.
