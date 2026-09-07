# Interactive Visual Bracket — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-06

## Goal

Replace the current admin bracket page's flat, top-to-bottom list of every
match (`src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx`)
with a real interactive bracket: a connected tree for single/double
elimination, a tappable card grid for round robin/pool play, and a
mobile-first bottom sheet for entering a result — tapping a match is the
primary interaction, not scrolling to a small "Enter Result" disclosure.
Also gives the player-facing read-only view (`src/app/events/[eventId]/page.tsx`)
the same visual treatment (still no editing there).

Only the *earliest incomplete round* of an elimination bracket is
editable — a later round can't legitimately be scored before its own
matchups are known, and per the round-based rule below, a round doesn't
open up until every match in the round before it is done, even if one
specific match in the new round already happens to have both teams known.
Round robin/pool play have no such dependency and stay fully editable at
any time, matching how they already work today.

## Non-goals

- **No change to scoring rules, validation, or the correction/review-cascade
  mechanism.** The best-of-sets/points-per-set/win-by config, `isValidSetScore`,
  and the downstream-review-needed flagging on a corrected completed match
  all shipped in the previous pass and are reused as-is.
- **No change to `editMatch`, `generateBracket`, `regenerateBracket`,
  `autoAssignSessions`, or `withdrawRegistration`.** Those stay exactly as
  they are today, as existing server-rendered forms below/around the new
  tree — this spec is scoped to the match-tap → view/score interaction
  only, not the admin's manual-override tools.
- **No schema or RLS changes.** This is a rendering/interaction change on
  top of data that's already fully there (`event_matches`, `event_match_sets`,
  `event_registrations`, `event_teams`).
- **No optimistic concurrency handling.** Same as every other admin
  mutation in this app today — two admins editing the same match at once
  isn't specifically guarded against.
- **No skill-based/seeded balancing, no free-agent registration.** Those
  are the two other items flagged during the same testing session; each
  gets its own separate design later.

## Library choice: bracketry

[`bracketry`](https://github.com/sbachinin/bracketry) (MIT, ~12kb
gzipped, DOM-based, framework-agnostic) renders the connected-tree layout
— round widths, connector lines, scroll/nav behavior — for a **single**
elimination shape. It explicitly does not support double elimination well
("technically possible but won't look nice") and has no round-robin/pool
concept at all.

Our data already splits a double-elim bracket into three independent
groups — `winners` / `losers` / `playoff` (`event_matches.bracket`) — and
each of those individually *is* a single-elim-shaped tree. So the
approach is one bracketry instance per group, not one call trying to draw
the whole double-elim shape. Round robin/pool play don't use bracketry at
all — they get a new hand-built `MatchCardGrid` (below), since there's no
tree to draw, but visually pulls its match-card look (colors, spacing,
typography) from bracketry's own default theme via shared CSS, so the
whole page reads as one system even though only part of it is actually
rendered by the library. Exact visual polish beyond that starting point
is explicitly deferred — ship matching-but-plain now, refine the look
later once the interaction itself is proven out.

Installed via `npm install bracketry` (pinned exact version, matching
this project's `package.json` convention), imported only inside a new
client component — never touches the server-rendered parts of the page.

## Component architecture

```
BracketPage (server component, unchanged data-fetching, + one new
             pure transform)
  └─ InteractiveBracket (new client component)
       ├─ BracketryTreeView   -- one per winners/losers/playoff group
       ├─ MatchCardGrid       -- one per round_robin/pool_* group
       └─ MatchResultSheet    -- the one shared bottom sheet, opened by
                                  either view's onMatchTap(match)
```

`BracketPage` keeps its existing queries (matches, sets, sessions,
registrations, teams, event scoring config) unchanged, and adds one new
pure function:

```ts
function toBracketryData(
  matches: EventMatch[],
  sets: EventMatchSet[],
  nameByRegistrationId: Map<string, string>
): { rounds: Round[]; matches: BracketryMatch[]; contestants: Record<string, Contestant> }
```

— built test-first, one call per bracket group. Contestant titles reuse
the page's existing `nameByRegistrationId` lookup; a completed match's
sets are passed through too so bracketry shows the score directly on the
tree, not just the eventual winner (today's flat list already shows this
as text, so no information is lost, just presented differently).

All of that — plus the raw `matches`/`sets`/event scoring config, needed
by the sheet — is passed as props into `InteractiveBracket`, a client
component. It owns: which match (if any) the sheet is currently open for,
and calling the score-submit action. Neither `BracketryTreeView` nor
`MatchCardGrid` know anything about scoring — they only call
`onMatchTap(match)` when a tappable match is tapped.

The same `BracketPage`/`InteractiveBracket` split is reused, in a
read-only mode, on the player-facing event page — `InteractiveBracket`
takes an `interactive: boolean` prop; when `false`, `onMatchTap` opens the
sheet in a view-only state (no form, no submit) instead of not opening it
at all, so players still get a nicer "see this match's detail" experience
than today's plain text row.

## Round locking

New pure function, test-first:

```ts
function computeActiveRounds(matches: EventMatch[]): Record<string, number>
```

Groups matches by `bracket` (`winners`/`losers`/`playoff` only — round
robin/pool groups are never passed in, since they have no locking
concept), and for each group returns the earliest `round_number`
containing at least one non-completed match. Every round before that is,
by definition, fully complete; every round after it is locked.

This is a stricter rule than "this specific match's two team slots are
both filled" (which the database already enforces structurally — a
round's match doesn't get real `team_a`/`team_b_registration_id` values
until its own two source matches finish via `applyAdvancement`). A
round-N+1 match can technically have both teams known before every
round-N match elsewhere in the bracket has finished, since advancement
propagates per-match, not per-round. `computeActiveRounds` deliberately
holds the *whole* round back until every match in the round before it is
done — matching what was actually asked for (a tournament director
reasons about "is Round 1 finished" as a unit, not match-by-match) even
though it's stricter than what the schema alone requires.

`BracketryTreeView` greys out any round past its group's active round and
disables `onMatchTap` for matches in it (a match with unknown teams
already renders as an empty/TBD slot in bracketry, so this mostly matters
for the one already-known-but-still-locked edge case above). `MatchCardGrid`
never applies this — round robin/pool matches are always tappable.

## Interaction design

Two decisions made visually during brainstorming:

- **Score entry is a bottom sheet**, not a full-screen takeover or an
  inline-expanding card. It slides up over a dimmed background, keeps the
  bracket visible/scrollable-adjacent behind it, and is the standard
  mobile pattern for a quick action on a list/tree item. It also sits
  entirely outside bracketry's own DOM, so it can't fight the tree's
  connector-line layout math the way an inline-expanding card risked
  doing.
- **Round navigation is horizontal scroll with a peek of the next round**
  (bracketry's own scroll-mode support), not one-round-at-a-time paging —
  so the "more rounds ahead" structure stays visually present at all
  times, including a visible (greyed) peek into a locked round.

`MatchResultSheet` renders the same fields the current "Enter/Edit
Result" form does (team names as column headers, `best_of_sets` set-score
rows, the "First to N, win by M" hint, forfeit checkbox + winner picker)
— this is a relocation of that existing form into the sheet, not a
redesign of the form itself.

## Submission flow

`recordMatchResult` (`src/app/admin/eventMatchActions.ts`) currently
always calls `redirect()`, on both success and validation failure — that
made sense for a server-rendered page with no client state to preserve.
This page now requires JS regardless (bracketry is a JS-rendered tree;
there's no meaningful no-JS version of a clickable bracket), so
`recordMatchResult` changes to return `{ ok: true }` or `{ ok: false,
error: string }` instead of redirecting. It currently has exactly one
caller (the page being replaced), so this is a plain signature change,
not a new parallel path.

`MatchResultSheet` drives it via React's `useActionState`: pending state
disables the Save button and shows a spinner; a returned error renders
inline in the sheet without closing it or losing the tree's scroll
position; success closes the sheet and calls `router.refresh()` to pull
updated data through the existing server-component queries.

The existing correction-cascade banner (a completed match's score being
corrected in a way that leaves a later completed match needing review)
still applies — on a successful correction with downstream impact, the
sheet closes, data refreshes, and the same warning banner renders at the
page level above the bracket (same content as today, just driven by the
action's returned data instead of a redirect's query param).

## Testing plan

- `toBracketryData` and `computeActiveRounds` are pure and built
  test-first — this is where the actual new logic lives, and both have
  clear edge cases worth naming up front: `toBracketryData` with a bye,
  with a still-TBD later round, and with a completed match's sets;
  `computeActiveRounds` with an empty bracket, a fully-completed bracket,
  and the "round N+1 match already has both teams but a sibling round-N
  match is still pending" case above.
- `InteractiveBracket`'s lock-gating and sheet open/close/submit-success
  behavior get RTL tests (this project's convention for client-component
  interaction bugs), with `bracketry`'s `createBracket` mocked out —
  no attempt to test the library's own rendering, only our wrapper logic
  around it.
- Everything else (visual correctness of the tree/grid, the actual bottom
  sheet feel, live score entry end-to-end) verified live against the
  seeded test tournament, same as every other feature in this project.

## Manual verification plan

- Generate a single-elim bracket on the seeded tournament; confirm the
  tree renders with connector lines, Round 1 is tappable, and later
  rounds show as greyed TBD.
- Score every Round 1 match; confirm Round 2 becomes tappable only once
  *all* of Round 1 is done (not as soon as an individual Round 2 match's
  two teams happen to both be known).
- Edit an already-completed match's score in a way that changes the
  winner and cascades into an already-completed downstream match; confirm
  the review-needed banner appears with the right match listed.
- Generate a double-elim bracket; confirm winners/losers/playoff each
  render as their own tree, and that locking is independent per group.
- Generate a round-robin bracket; confirm every match is tappable at any
  time regardless of round, using the new card-grid layout (not
  bracketry).
- Enter an invalid score (fails win-by) inside the sheet; confirm the
  error shows inline and the sheet stays open with the entered values
  intact.
- Resize to a narrow/mobile viewport; confirm the bottom sheet and the
  horizontal-scroll-with-peek round navigation both work one-handed.
- Confirm the player-facing event page renders the same tree/grid
  read-only, with tapping a match opening a view-only detail sheet
  (no form, no submit).
