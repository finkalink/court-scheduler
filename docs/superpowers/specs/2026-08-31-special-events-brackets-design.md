# Special Events, Brackets (Plan 3 of 4) — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-08-31

## Goal

Give events with a `tournament`, `league`, or pool-play structure an actual
bracket: generate matches from registered teams/individuals, record results,
auto-advance winners, compute standings, and show both to players. This is
item 3 of the four-part decomposition in
`docs/superpowers/specs/2026-08-30-special-events-design.md` ("Future
decomposition"), building on the already-shipped core events/sessions
(Plan 1) and registration/teams/waitlist (Plan 2).

All four formats described in the original design's `event_matches` schema
are in scope for this plan: single-elimination, double-elimination, round
robin, and pool play (optionally feeding a playoff bracket). A league's
regular season (round robin spread across weekly matches) and a subsequent
multi-week playoff bracket are both accounted for — see `event_matches
.session_id` under Data model and "Auto-assign to sessions" under Admin UI.

## Non-goals

- **No new court/time booking from match assignment.** Linking a match to a
  session only *points at* an `event_sessions` row that already exists (and
  already blocks its court time via the existing `bookings` mechanism) — it
  never creates, moves, or resizes a session. Court/time management stays
  exactly where it already lives, on the event's existing Sessions section.
- **No capacity-aware auto-scheduler.** The auto-assign convenience (see
  Admin UI) is a simple ordered pairing — round order to session start-time
  order — not a scheduler that understands "3 courts free this week" or
  reshuffles anything. When counts don't line up, leftover matches or
  sessions are left for the admin to sort out by hand.
- **No general user-profile system.** Individual (non-team) registrations
  gain a narrow `display_name` field, just enough to show a name in the
  bracket. Real profile fields (name, gender, level of play, etc.) are a
  separate, cross-cutting feature — also logged as a follow-up, not folded
  in here.
- **No automatic pool → playoff promotion rule.** After pool play, an admin
  reads the standings table and manually generates the playoff bracket from
  whichever registrations they choose (same generation mechanism as any
  other bracket) — there's no "top 2 per pool" auto-qualification logic.
- **No bracket-reset grand final for double-elimination.** The losers-bracket
  finalist plays the winners-bracket champion once; if the losers-bracket
  team wins, they're the champion — there's no second "if necessary" match.
  A documented simplification, not an oversight.
- **Three-plus-way standings ties fall through to point differential only.**
  Head-to-head tie-breaking only applies when exactly two registrations are
  tied; anything wider skips straight to point differential. Keeps
  `computeStandings` a pure sort rather than a round-robin tie-break
  algorithm.

## Data model

New migration: `supabase/migrations/0020_event_brackets.sql`

```sql
create table event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bracket text not null, -- 'winners' | 'losers' | 'round_robin' | 'pool_a', 'pool_b', ... | 'playoff'
  round_number integer not null,
  slot_in_round integer not null,
  team_a_registration_id uuid references event_registrations(id),
  team_b_registration_id uuid references event_registrations(id),
  team_a_advances_from_match_id uuid references event_matches(id),
  team_b_advances_from_match_id uuid references event_matches(id),
  advancement_type_a text check (advancement_type_a in ('winner', 'loser')),
  advancement_type_b text check (advancement_type_b in ('winner', 'loser')),
  winner_registration_id uuid references event_registrations(id),
  is_bye boolean not null default false,     -- auto-completed: one side was a bye
  is_forfeit boolean not null default false, -- winner set with no sets played
  admin_note text,                            -- player-visible rationale for a forfeit/correction
  session_id uuid references event_sessions(id), -- which of the event's existing sessions this match is played at, if any
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'completed'))
    -- 'pending': no session assigned yet. 'scheduled': session_id is set,
    -- not yet played. 'completed': result recorded. A match can go straight
    -- from 'pending' to 'completed' too (session-less, e.g. a same-day
    -- tournament where the whole event is one big block of court time) --
    -- 'scheduled' is opt-in, not a required step.
);

create table event_match_sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references event_matches(id) on delete cascade,
  set_number integer not null check (set_number >= 1),
  team_a_points integer not null check (team_a_points >= 0),
  team_b_points integer not null check (team_b_points >= 0),
  unique (match_id, set_number)
);

alter table event_registrations add column display_name text;
-- Nullable, no backfill (same pattern as slot_size_minutes, location
-- geocoding) -- required by the app for new individual registrations going
-- forward; existing individual registrations show a placeholder in the
-- bracket until the registrant re-registers or an admin sets it manually.

alter table event_matches enable row level security;
alter table event_match_sets enable row level security;

-- Public read (non-sensitive schedule/result data, same tier as
-- events/event_sessions/event_teams). Write requires org membership --
-- staff included, matching every other "day-to-day scheduling" table.
create policy "event_matches select all" on event_matches
  for select using (true);
create policy "event_matches write member" on event_matches
  for insert with check (public.is_org_member(public.org_id_for_location(
    (select location_id from events where id = event_id))));
create policy "event_matches update member" on event_matches
  for update using (public.is_org_member(public.org_id_for_location(
    (select location_id from events where id = event_id))));
create policy "event_matches delete member" on event_matches
  for delete using (public.is_org_member(public.org_id_for_location(
    (select location_id from events where id = event_id))));

create policy "event_match_sets select all" on event_match_sets
  for select using (true);
create policy "event_match_sets write member" on event_match_sets
  for insert with check (public.is_org_member(public.org_id_for_location(
    (select location_id from events e join event_matches m on m.event_id = e.id
     where m.id = match_id))));
create policy "event_match_sets delete member" on event_match_sets
  for delete using (public.is_org_member(public.org_id_for_location(
    (select location_id from events e join event_matches m on m.event_id = e.id
     where m.id = match_id))));
-- No update policy on event_match_sets: correcting a set's score is
-- delete-and-reinsert via the "Edit Match" flow re-submitting all sets,
-- not an in-place row edit -- matches the blocked_slots/event_sessions
-- convention of insert-or-delete over update wherever the row represents
-- a replaceable fact rather than a field that changes in place.

create index event_matches_event_idx on event_matches (event_id, bracket, round_number);
create index event_match_sets_match_idx on event_match_sets (match_id);
```

## Pure logic

All of the following are built test-first, extending this codebase's
established convention of isolating pure functions for anything with real
branching logic.

**`src/lib/bracketGeneration.ts`** (new):

```ts
export interface SeedSlot {
  registrationId: string | null; // null = bye
  seed: number;
}

export function generateSingleElimBracket(
  seeds: SeedSlot[],
  eventId: string
): NewEventMatch[];

export function generateDoubleElimBracket(
  seeds: SeedSlot[],
  eventId: string
): NewEventMatch[];

export function generateRoundRobinMatches(
  registrationIds: string[],
  eventId: string,
  bracket: string // 'round_robin' or a pool label like 'pool_a'
): NewEventMatch[];

export function generatePoolPlayMatches(
  pools: Record<string, string[]>, // pool label -> registration ids
  eventId: string
): NewEventMatch[];
```

- **Single elimination:** bracket size rounds up to the next power of 2;
  standard tournament seeding order places byes (auto mode: top seeds get
  the byes; manual mode: the admin marks specific seed slots as bye before
  generation). A bye match is created already `completed`/`is_bye = true`
  with the real team as `winner_registration_id`, and its win is propagated
  into round 2 immediately as part of generation (calls the same
  advancement function described below).
- **Double elimination:** winners bracket generated the same way as single
  elimination; a losers bracket is generated alongside it with the standard
  double-elim losers-round structure, each losers-round slot fed either by
  a dropped loser from a winners round (`advancement_type = 'loser'`) or a
  winner advancing within the losers bracket itself. A final `'playoff'`
  bracket match (grand final) is fed by the winners-bracket champion and the
  losers-bracket champion — see the Non-goals note on why there's no
  bracket-reset second match.
- **Round robin:** every pair plays once; `round_number` is assigned via the
  standard circle method so matches group into rounds where no registration
  repeats within a round (useful for display grouping even though no
  per-match scheduling exists yet).
- **Pool play:** the circle method applied independently within each pool
  label.

**`src/lib/matchAdvancement.ts`** (new):

```ts
export function propagateAdvancement(
  completedMatch: EventMatch,
  allMatches: EventMatch[]
): { updatedMatches: EventMatch[]; secondHopWarnings: EventMatch[] };
```

Finds any match(es) referencing `completedMatch.id` via
`team_a_advances_from_match_id`/`team_b_advances_from_match_id`, fills their
slot with `winner_registration_id` (or the loser, for
`advancement_type = 'loser'` losers-bracket slots). If a downstream match is
already `completed`, it's left untouched but returned in
`secondHopWarnings` for the UI to flag rather than silently re-cascaded.

**`src/lib/standings.ts`** (new):

```ts
export interface StandingsRow {
  registrationId: string;
  wins: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

export function computeStandings(
  matches: EventMatch[],
  sets: EventMatchSet[],
  registrationIds: string[]
): StandingsRow[];
```

Sorted by win % desc, then point differential desc, then (exactly-two-way
ties only) head-to-head result between the tied pair.

**Set-score entry helper:** a small pure function derives the match winner
from a set of `{team_a_points, team_b_points}` entries (majority of sets
won) — used by the result-entry server action before it writes
`winner_registration_id`.

**`src/lib/matchScheduling.ts`** (new):

```ts
export function pairMatchesToSessions(
  matches: EventMatch[],  // not yet completed, sorted by round_number then slot_in_round
  sessions: EventSession[] // the event's existing sessions, sorted by start_time
): { matchId: string; sessionId: string }[];
```

A straight zip in order — the Nth not-yet-scheduled match (by round, then
slot) pairs with the Nth session (by start time). Stops when either list
runs out: extra matches are left unassigned, extra sessions are left
unused. No notion of "week" or court capacity — the admin controls both
orderings simply by how they created sessions and how the bracket was
generated (e.g. one session per week for a weekly round robin, or several
same-day sessions across different courts for a same-day tournament).

## Admin UI

New page: `/admin/locations/[locationId]/events/[eventId]/bracket`, linked
from the existing event management page (`.../events/[eventId]`), which
stays focused on details/sessions/team-assembly and doesn't grow further.

- **No matches yet:** generation config form — format select, seeding method
  (registration order / random / manual reorder — a simple numbered list
  with up/down controls, no drag-and-drop library, matching this app's
  plain-HTML-forms convention), bye handling for elim formats (auto / manual
  bye-slot marking), and a pool-assignment step for pool play (one select
  per registrant, grouping them into however many pools the admin
  configures). Submits to a new `generateBracket` action
  (`src/app/admin/eventMatchActions.ts`).
- **Matches exist:** per-round (elim) or per-pool (round robin/pool play)
  match list. Each row shows both sides, status, and:
  - **Enter Result** disclosure — per-set score inputs (a fixed handful,
    blank ones ignored) plus a "Forfeit / Walkover" toggle that skips sets
    and just picks a winner directly.
  - **Edit Match** disclosure, available on any match regardless of status —
    change either side's registration, re-enter sets, override the winner,
    and an `admin_note` field explaining the change. On save: propagates one
    hop via `propagateAdvancement`; any `secondHopWarnings` render as a
    banner naming the affected downstream match(es).
  - A **Session** field within Edit Match — a dropdown of the event's own
    `event_sessions` (plus "None") — links this match to when/where it's
    actually played. Setting it moves the match from `pending` to
    `scheduled`; it has no effect on `bookings`/court-blocking, which the
    session already handles.
  - Standings table(s) rendered above/alongside the round robin or pool
    match lists.
  - **Regenerate** button, shown only while no match has status
    `completed`; deletes all matches/sets (and their session links) and
    returns to the config form.
- **Auto-assign to sessions**, shown whenever there are both unscheduled
  matches and unused sessions for the event: runs `pairMatchesToSessions`
  and links them in order in one action; any leftover matches or sessions
  are reported ("4 matches assigned, 2 matches still need a session") so
  the admin can finish the rest manually via Edit Match.
- **Withdraw**, on the event's registrant list (this page or the existing
  team-assembly section): sets that `event_registrations` row to `cancelled`
  and, if it currently occupies a not-yet-completed match slot, prompts the
  admin to either mark that match a forfeit for the opponent or pick any
  other registration for the event to substitute into the vacated slot.

New server actions in `src/app/admin/eventMatchActions.ts`: `generateBracket`,
`regenerateBracket`, `recordMatchResult`, `editMatch`, `autoAssignSessions`,
`withdrawRegistration`.

## Player UI

New section on `/events/[eventId]` (existing page), shown once matches
exist for the event:

- **Elimination brackets** (`winners`/`losers`/`playoff`): a horizontally
  scrolling row of round columns (native `overflow-x-auto`, same pattern as
  the weather widget's hourly-forecast strip — no new scrolling library),
  each with a sticky round-name header. Matches render as compact cards
  (both sides' names, a short score summary, winner highlighted); tapping a
  card expands it (new client component, `src/components/MatchCard.tsx`) to
  show full per-set scores and any `admin_note`. A card whose match has a
  `session_id` also shows that session's date/time/court (e.g. "Week 3 —
  Sept 10, 7:00 PM, Court 2"), so a league's players can see their actual
  schedule, not just the bracket structure.
- **Round robin / pool play:** standings table(s) plus a flat list of
  matches with scores (each showing its session date/time/court when
  linked), no tree needed.
- Individual-registration display names come from the new
  `event_registrations.display_name`; team registrations continue to use
  `event_teams.name`, unchanged.

`registerForEvent` (`src/app/actions/events.ts`) gains a required
"Display name (shown in results)" text input on the individual-registration
path only — the team path already collects a team name.

## Testing plan

- `generateSingleElimBracket`/`generateDoubleElimBracket` — bracket sizing
  and bye placement for non-power-of-2 counts, both auto and manual bye
  modes, correct advancement-link wiring, double-elim losers-bracket shape,
  grand final feed.
- `generateRoundRobinMatches`/`generatePoolPlayMatches` — every pair plays
  exactly once, circle-method round assignment, independent pools.
- `propagateAdvancement` — single-hop fill, `advancement_type = 'loser'`
  case, second-hop warning when downstream is already completed.
- `computeStandings` — win %/point-diff ordering, two-way head-to-head
  tie-break, three-way tie fallthrough.
- Set-score-to-winner derivation helper.
- `pairMatchesToSessions` — in-order zip, leftover matches when sessions run
  out, leftover sessions when matches run out, empty-list edge cases.
- No new tests for the admin/player page components or server actions
  themselves (server components/actions aren't unit-tested elsewhere in
  this codebase) — verified manually in the browser, plus live
  role-impersonation checks on the new RLS policies (the pattern the last
  two Special Events plans' final reviews relied on to catch
  compose-two-things-together gaps).

## Manual verification plan

- Apply the migration; confirm RLS as a staff account (writes succeed) and
  an anonymous visitor (matches/standings are readable, writes rejected).
- Generate a single-elim bracket for a non-power-of-2 registrant count in
  both bye modes; confirm bye matches auto-complete and propagate.
- Generate a double-elim bracket; play it through to the grand final,
  confirming losers-bracket drops and the single-match grand final.
- Generate round robin and pool play brackets; confirm standings ordering
  and the two-way head-to-head tie-break with a contrived tie.
- Enter a forfeit result and confirm the opponent advances with no sets
  recorded.
- Edit an already-completed match that fed a downstream match: confirm the
  one-hop auto-propagation, then complete the downstream match and edit the
  original again to confirm the second-hop warning appears instead of a
  silent cascade.
- Withdraw a registration with a pending match: exercise both the
  forfeit-opponent path and the substitute-registration path.
- Confirm the player-facing bracket renders correctly on a narrow (mobile)
  viewport — horizontal scroll, sticky round headers, tap-to-expand.
- Confirm an individual registrant's `display_name` renders correctly in
  the bracket, and that a pre-existing individual registration with no
  `display_name` shows its placeholder without erroring.
- **League shape:** create an event with several weekly `event_sessions`
  already set up, generate a round-robin bracket for it, run "Auto-assign
  to sessions," and confirm matches land on the right weeks in order.
  Manually reassign one match to a different session via Edit Match and
  confirm it moves. Confirm a player sees each match's actual week/court on
  its card. Then generate a follow-up single-elim playoff bracket for the
  same event once the regular season is done, assign it to a further batch
  of sessions the same way, and confirm the regular-season matches and
  playoff matches coexist without interference (different `bracket` labels,
  independent standings).

## Follow-up backlog items (log in CLAUDE.md once this ships)

- Capacity-aware auto-scheduling (if the simple ordered-pairing turns out
  insufficient for locations running multiple simultaneous courts per
  week).
- User profiles (name, gender, level of play, etc.) as their own
  cross-cutting feature.
