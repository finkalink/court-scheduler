# Team Roster Visibility & Membership Integrity — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-01

## Goal

Two related gaps in the shipped Special Events registration/team system
(`docs/superpowers/plans/2026-08-31-special-events-registration.md`):

1. **Roster visibility.** `event_team_members` has been public-select in
   the database since it was created, but no player-facing page actually
   shows a team's roster — only "Your team is registered" for the
   viewer's own team. Any player should be able to see who's on a given
   team.
2. **Membership integrity.** Self-formed team registration
   (`registerForEvent`, `src/app/actions/events.ts`) lets a captain add
   teammates as pure free-text names with no account tie-in at all. Going
   forward, every new roster spot should resolve to a real account —
   immediately if the teammate is already registered, or eventually if
   they're not yet on the platform.

This reverses a deliberate non-goal from the original design
(`docs/superpowers/specs/2026-08-30-special-events-design.md`: "No
invite/accept flow for team rosters... a real invite flow is a plausible
future enhancement, not part of this spec") now that the product need is
concrete.

## Non-goals

- **No transactional email.** This app has no email-sending
  infrastructure at all yet (a separate, already-deferred backlog item).
  "Inviting" a not-yet-registered teammate never sends anything — the
  captain is responsible for telling that person, out of band, to sign up
  with the exact email address entered. The moment they do, the roster
  spot auto-links (see below).
- **No player directory or name search.** `users` has no name field
  today (a separate, already-deferred "user profiles" backlog item) —
  only email. "Search for an existing player" is exact-email-match only,
  never partial/fuzzy, and never returns a browsable list: a captain can
  only confirm or invite one specific email they already know, not
  discover who else is on the platform.
- **No backfill of existing rosters.** Team members added before this
  ships (pure free-text, no `user_id`, no email captured) are left as-is
  — display-only forever, since there's no email to link them by. Same
  "no backfill" convention as `slot_size_minutes`, the geocoding columns,
  etc.
- **No self-removal for a newly-linked teammate.** `event_team_members`'s
  delete policy is captain-or-org-member only (not "any member," unlike
  the broader `event_registrations` cancel policy from Plan 2) — an
  auto-linked teammate who doesn't want to be on the team can't remove
  just themselves from the roster today. Pre-existing, unrelated to this
  feature, not addressed here.
- **No change to capacity/waitlist timing.** A team's `event_registrations`
  row is created — and counts against capacity — as soon as the captain
  finishes team setup, exactly as today, regardless of how many roster
  spots are still pending. No new "partially registered" state.
- **Admin-assembled team events are already compliant** and untouched by
  this spec — `assembleEventTeam` only ever groups already-individually-
  registered accounts, so there's no free-text path to close there.

## Data model

New migration:

```sql
alter table event_team_members add column invited_email text;
-- Set exactly when user_id is null and this is a pending (not-yet-signed-up)
-- teammate, as opposed to a pre-existing free-text-only row from before
-- this feature, which has neither column populated.

create unique index event_team_members_invited_email_unique
  on event_team_members (invited_email)
  where invited_email is not null;
-- One pending invite per email at a time, app-wide (not just per team) --
-- keeps the signup-time auto-link lookup a single unambiguous match.

-- Exact-match lookup, callable by any authenticated user (not just org
-- members -- any player can be a team captain). Returns only an opaque
-- user_id for an email the caller already typed themselves; not a new
-- enumeration surface since it confirms/denies one specific email at a
-- time, never a list.
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
```

`event_team_members`'s existing RLS is unchanged (public-select,
captain-or-org-member insert/delete) — the new `invited_email` column
technically becomes publicly readable too under the existing `using
(true)` policy, but this is closed at the *application* layer instead:
no player-facing query ever selects or renders that column. The
org-side admin-assembly view and the signup-time auto-link lookup are
the only legitimate readers, and both already run with elevated
context (org member / server-side signup flow).

## Add-teammate flow

The self-formed registration form (`src/app/events/[eventId]/page.tsx`)
replaces its five free-text `teammate_name` inputs with five **name +
email** pairs — both fields required together, or both left blank to
skip that slot. In `registerForEvent`, for each filled slot:

1. Call `find_registered_user_by_email(email)`.
2. **Match found** → insert `event_team_members` with `user_id` set,
   `display_name` = whatever the captain typed (never the email).
3. **No match** → insert with `invited_email` set, `user_id` null,
   `display_name` as typed.

This one lookup serves both "search for an existing player" (the found
case) and "invite by email" (the not-found case) as a single flow with
two outcomes, rather than two UIs the captain has to pick between up
front. After submitting, each slot shows which outcome it got — "linked
to an existing account" or "Pending — ask them to sign up with this
email" — so the captain can see who still needs to join.

**Collision handling:** the `invited_email` unique index means a second
pending invite for the same email — from a duplicate slot in the same
submission, a different team, or a different event entirely — hits a
`23505` unique-violation on insert. Caught the same way
`registerForEvent`'s existing `event_registrations` unique-violation is
today: a friendly per-slot message ("That email already has a pending
invite elsewhere") rather than a raw error.

The captain's own roster row gains a required display-name prompt on
the registration form too, fixing the existing `display_name: user.email`
default, which today leaks the captain's own email onto the (already
public) roster.

## Auto-link at signup

In `signUp` (`src/app/actions/auth.ts`), immediately after the new
Supabase Auth user is created: look up `event_team_members` rows where
`invited_email` equals the just-registered email and `user_id is null`,
set `user_id` to the new account, and clear `invited_email`. Runs
unconditionally on every signup (not just ones that arrived via an
invite link, since there is no invite link) — correct either way, since
signing up with that exact address is what the pending spot was
addressed to.

## Roster visibility

New "Roster" section on the player-facing event detail page
(`src/app/events/[eventId]/page.tsx`), rendered for every team-mode
event for every viewer — not just the current user's own team. For each
team: captain first, then members, each showing `display_name`; a
still-pending spot additionally shows a small "Pending" label (a plain
status word, not sensitive — no email rendered). Sourced from the same
`event_teams`/`event_team_members` join pattern already used elsewhere
on this page, scoped to the event's teams.

## Testing plan

- No new pure-logic module — the lookup-then-branch logic in
  `registerForEvent` is a straightforward two-way branch on an RPC
  result, consistent with this codebase's convention of not extracting
  simple server-action branching into a separately-tested pure function
  when the branch itself has no independent logic to unit test.
- Server actions, RLS, and page components are verified manually in the
  browser, per this codebase's established convention.

## Manual verification plan

- Apply the migration; confirm the unique partial index rejects a second
  pending invite for the same email, and confirm
  `find_registered_user_by_email` works for any authenticated player
  (not just org members) and returns null for a non-existent email.
- Self-formed registration: add one teammate whose email matches an
  existing account (confirm immediate link) and one whose email doesn't
  (confirm pending state), in the same team.
- Sign up a new account using a pending invite's exact email; confirm
  the roster spot auto-links and the "Pending" label disappears.
- Confirm the captain's own roster row now requires and shows a typed
  display name, not their email.
- Confirm the new "Roster" section on the event detail page shows every
  team's full roster (including pending spots, labeled) to a visitor who
  is not a member of any team, and that no email address is ever
  rendered on that page.
- Confirm a pre-existing (pre-migration) free-text-only roster row still
  displays correctly and doesn't error, despite having neither `user_id`
  nor `invited_email`.
- Invite the same not-yet-registered email to two different teams (or
  twice in one form submission); confirm the second attempt shows a
  friendly "already has a pending invite" message rather than a raw
  database error, and the first invite is unaffected.
