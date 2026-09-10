# Blind Draw team generation

Closes the "Blind Draw" backlog item: one click to auto-split individually-registered
players into skill-balanced teams, instead of the existing all-manual `assembleEventTeam`
(one team, hand-picked, per submit).

Applies only to events where `registration_mode = 'team'` and `team_formation =
'admin_assembled'` — the same scope `assembleEventTeam` already covers. Blind Draw is an
additional, faster path to the same end state (teams + team-level registrations); it does
not replace manual assembly, which stays for one-off fixes.

## Decisions (resolved via AskUserQuestion with the user)

- **Rating source:** each registrant's `users.skill_level` (already shipped, unrelated to
  this feature) is the default rating. The admin can override any registrant's rating for
  this draw only — the override is never persisted, it only affects this one draw's
  assignment.
- **Team count:** no fixed team count or fixed size stored anywhere. The admin enters a
  target team size at draw time; the algorithm computes however many teams that implies
  from the actual registrant pool, distributing as evenly as possible (sizes differ by at
  most 1 — some teams may come out smaller than the target, never larger).
- **Commit flow:** drawing produces a *proposed* arrangement, not a write. The admin
  reviews it, can move any registrant to a different proposed team or rename a team, then
  explicitly confirms. Only confirming writes to the database.

## Data model

No new columns or tables. `users.skill_level` (letters: `Recreational`/`B`/`BB`/`A`/`AA`/`Open`)
is reused as-is. A registrant with no `skill_level` set blocks the draw from running until
the admin fills in a rating for them in the draw form (same "don't guess, ask" posture as
the profile-completeness gate elsewhere) — this is a form-level requirement, not a new DB
constraint.

One new SD RPC, `list_event_registrant_profiles(check_event_id)` — same shape/security
posture as the existing `list_event_registrant_emails` (mig 0017), but also returns
`skill_level`. Added as a new function rather than changing the existing one, since
`assembleEventTeam` doesn't need skill data and there's no reason to touch working code.

## Algorithm (`src/lib/blindDraw.ts`, pure, TDD)

- `SKILL_LEVELS` — the canonical rank order, lowest to highest:
  `["Recreational", "B", "BB", "A", "AA", "Open"]`.
- `computeTeamSizes(registrantCount, targetTeamSize): number[]` — team count is
  `ceil(registrantCount / targetTeamSize)`, so no team ever exceeds the target; sizes are
  then spread as evenly as possible (`registrantCount` split across that many teams,
  remainder distributed one-per-team starting from the first), so trailing teams may come
  out smaller. Example: 13 registrants, target 6 → 3 teams sized `[5, 4, 4]`.
- `drawBalancedTeams(registrants, targetTeamSize): DrawnTeam[]` — sorts registrants by rank
  descending (stable for ties), then greedily assigns each one to the not-yet-full team
  with the current lowest total rank sum. This is a standard "draft to the team that needs
  it most" balancer; it naturally degrades to an even split when ratings are all equal, and
  handles uneven team sizes (from `computeTeamSizes`) without needing an exact snake-order
  pass. Deterministic given the same input order, which matters for testability.

## UI

New "Blind Draw" section on the admin event detail page
(`src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`), next to the existing
"Assemble Teams" section, same visibility gate (`registration_mode==='team' &&
team_formation==='admin_assembled'`) and same ungrouped-registrant query already fetched
there (reused, not duplicated).

1. **Draw form** — target team size (number input) + one rating `<select>` per ungrouped
   registrant, pre-filled from their profile's `skill_level` when set, otherwise blank and
   required. Submits via `proposeBlindDraw` (`useActionState`, mirrors
   `recordMatchResult`'s convention) — returns a proposed arrangement, no DB write.
2. **Review step** (`BlindDrawReview`, new client component) — one column per proposed
   team: editable team-name text input + each member's name with a `<select>` to move them
   to a different proposed team (no drag-and-drop library — this codebase has none and the
   existing UI conventions are plain form controls). "Confirm Teams" submits the final
   arrangement to `commitBlindDraw`; "Start Over" discards the proposal and returns to the
   draw form.
3. **Commit** (`commitBlindDraw`, server action) — same per-team sequence as
   `assembleEventTeam` (insert `event_teams` row, insert `event_team_members` rows, delete
   the consumed individual `event_registrations`, insert one team-level registration row),
   looped across all proposed teams with a running registered-count so later teams in the
   same commit correctly see earlier ones' capacity impact; `promote_next_waitlisted`
   called once at the end, matching the existing action.

## Out of scope

- Drag-and-drop reordering (plain `<select>`-based reassignment instead).
- Persisting a draw-time rating override anywhere (single-use, form-only).
- Any change to `assembleEventTeam` or the self-formed team path.
