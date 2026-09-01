# User Profiles — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-01

## Goal

Give players a real profile — name, gender, level of play — resolving a
gap that surfaced twice already: the brackets plan
(`docs/superpowers/plans/2026-08-31-special-events-brackets.md`) needed a
one-off `display_name` on individual registrations specifically because
`users` had no name field, and the team-roster-visibility plan
(`docs/superpowers/specs/2026-09-01-team-roster-visibility-design.md`)
had to scope "find an existing player" to exact-email-match only for the
same reason. Skill level and gender are captured now so future features
(skill-based seeding, gendered divisions) have real data to build against,
without those features needing to exist yet.

Registration for anything other than an `open_play` event now requires a
complete profile — name, gender, and skill level all set — since those
events are the ones where knowing who's actually showing up, and at what
level, matters.

## Non-goals

- **Gender and skill level aren't consumed anywhere yet.** No feature in
  this spec reads them for seeding, filtering, or matching — they're
  captured now so a future feature can, without this plan needing to
  guess what that feature will look like. Visible only to the profile's
  own owner (existing `users select own` RLS), not shown publicly and not
  newly exposed to org admins.
- **No retroactive enforcement.** The registration gate applies only to
  new registration attempts going forward; players already registered for
  a non-open-play event before this ships are completely unaffected.
- **No change to per-registration display names.** `event_registrations
  .display_name` and `event_team_members.display_name` (from the brackets
  and team-roster-visibility work) stay exactly as they are — free-text,
  per-registration, overridable. This spec only pre-fills them from the
  profile's name when set; it doesn't remove the override.
- **No avatar/photo, no profile visibility settings.** Just the three
  fields.
- **No admin-facing profile management.** Org admins can't view or edit a
  player's profile through this spec — a player manages only their own.

## Data model

```sql
-- users.name already exists (nullable, added in 0001_init.sql, never
-- written to by any code path until now).
alter table users add column gender text
  check (gender in ('male', 'female', 'prefer_not_to_say'));
alter table users add column skill_level text
  check (skill_level in ('Recreational', 'B', 'BB', 'A', 'AA', 'Open'));
```

No RLS changes — `users update own` (`id = auth.uid()`) and `users select
own` already cover a player reading/editing their own profile row.

**Skill-level tiers**, shown with a brief description alongside each
option so a player can self-assess:

| Tier | Description |
|---|---|
| Recreational | Just here to have fun and stay active — new to volleyball or plays casually |
| B | Knows the basic rules and skills, still building consistency |
| BB | Comfortable with fundamentals, plays in casual competitive leagues |
| A | Strong all-around player with consistent skills |
| AA | Highly skilled, plays regularly at a competitive level |
| Open | Elite / collegiate-or-above competitive player |

The profile form offers two ways to set this, for players who do and
don't already know the letter-rating convention:

- **Letter picker:** all six tiers directly, each with its description.
- **Plain-language picker:** Recreational, Beginner, Intermediate,
  Advanced, Competitive. Only the letter value is ever stored — Beginner
  → `B`, Intermediate → `BB`, Advanced → `A`, Competitive → `Open`.
  Recreational is shared between both pickers and stores directly as
  `Recreational`, no mapping needed. `AA` is reachable only via the
  letter picker — a deliberate gap, since the plain-language scale is
  intentionally coarser and a player who specifically knows they're `AA`
  presumably knows the letter system.

## Signup & Profile page

Signup (`src/app/signup/page.tsx` / `signUp` in
`src/app/actions/auth.ts`) gains three optional fields — name, gender,
skill level (same picker as above) — all skippable, since requiring them
would add friction to account creation itself. Any fields provided are
written to the new `users` row in the same action, right after
`supabase.auth.signUp()` succeeds (the `handle_new_user` trigger has
already created that row with `id`/`email` by that point — same timing
reasoning already established by the team-roster-invite work's
`claim_pending_team_invites`).

New `/profile` page, linked from `AppShell`'s nav alongside "My
Bookings"/"My Events" — a form pre-filled with the signed-in player's
current `name`/`gender`/`skill_level`, saved via a new `updateProfile`
server action (`src/app/actions/profile.ts`) that updates their own
`users` row. This is the only place to complete or change a profile after
signup. A blank name field is stored as `null`, not an empty string — so
`isProfileComplete` only ever needs to check for `null`/missing, never an
empty-string edge case, on either the signup or profile-update write
path.

## Registration gate

In `registerForEvent` (`src/app/actions/events.ts`), right after the
existing event-status check: if `event.event_type !== 'open_play'` and
the caller's profile is missing `name`, `gender`, or `skill_level`,
redirect to `/profile?next=/events/{eventId}&message=Complete your
profile to register for this event.` instead of proceeding. The `event`
query gains `event_type` to its select list (not currently fetched
there). Applies uniformly to individual and team registration,
self-formed and admin-assembled alike, since both paths funnel through
this same action — no format-specific special-casing needed. `/profile`'s
save action redirects to `next` when present, so completing the profile
lands the player back on the event they were trying to register for.

A pure `isProfileComplete(profile: { name, gender, skill_level }):
boolean` function (`src/lib/userProfile.ts`, built test-first) backs this
check.

## Connecting to what motivated this

Two small, direct wins now that `users.name` is real:

- The individual-event registration form and the self-formed-team
  captain's own display-name field (`src/app/events/[eventId]/page.tsx`)
  both pre-fill from the signed-in player's `users.name` when set,
  instead of starting blank — still editable/overridable per-registration
  (a fun team nickname stays possible), just no longer requiring a fresh
  retype every time.
- Nothing else changes in the brackets or team-roster-invite code —
  `event_registrations.display_name` / `event_team_members.display_name`
  stay exactly as they are, just better defaulted.

## Testing plan

- `isProfileComplete` — unit-tested test-first: all fields present, each
  field individually missing, empty-string-as-missing.
- No new tests for the signup/profile-page/registration-gate server
  actions or page components themselves (server components/actions
  aren't unit-tested elsewhere in this codebase) — verified manually in
  the browser.

## Manual verification plan

- Apply the migration; confirm the two new check constraints reject an
  invalid value and accept every listed tier/gender option.
- Sign up a new account leaving all three profile fields blank; confirm
  the account is created successfully and `/profile` shows them all
  empty afterward.
- From `/profile`, set name/gender/skill level (try both the letter and
  plain-language skill pickers, including a plain-language selection that
  should auto-map — e.g. Advanced → `A` in the database) and save;
  confirm the values persist and `/profile` reflects them on reload.
- As a player with an incomplete profile, attempt to register for a
  `tournament`/`league`/`clinic` event; confirm the redirect to
  `/profile` with the completion message, and confirm completing the
  profile there lands back on the original event's page.
- Confirm the same incomplete-profile player *can* register for an
  `open_play` event without any gate.
- Confirm a player with a saved `name` sees it pre-filled (but still
  editable) on both the individual-registration display-name field and
  the self-formed-team captain display-name field.
- Confirm a player who already registered for a non-open-play event
  before this shipped is unaffected — their existing registration isn't
  retroactively invalidated, and they aren't forced through `/profile` to
  view it.
