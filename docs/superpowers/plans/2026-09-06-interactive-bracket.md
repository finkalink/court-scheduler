# Interactive Visual Bracket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin bracket page's flat match list with a real interactive bracket — a connector-line tree (via the `bracketry` library) for single/double elimination, a tappable card grid for round robin/pool play, and a mobile-first bottom sheet for scoring — with round-based locking so only the earliest incomplete round can be scored. Give the player-facing event page the same visual treatment, read-only.

**Architecture:** Two new pure functions (`toBracketryData`, `computeActiveRounds`) transform existing `event_matches`/`event_match_sets` rows into bracketry's data shape and into a per-bracket-group "active round" map. A new client component tree (`InteractiveBracket` → `BracketryTreeView` | `MatchCardGrid` → shared `MatchResultSheet`) renders and drives interaction; `recordMatchResult` changes from a redirecting server action to one returning `{ok, error}`/`{ok, reviewNeeded}`, driven by React's `useActionState`.

**Tech Stack:** Next.js 16 / React 19 (`useActionState`), `bracketry@1.1.3` (new dependency), Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-06-interactive-bracket-design.md](../specs/2026-09-06-interactive-bracket-design.md)

## Global Constraints

- `bracketry`'s own shipped `.d.ts` references an internal path not included in the published package, so `import type {...} from "bracketry"` does not resolve real types — confirmed by spiking it against this project's `tsconfig.json` (`skipLibCheck: true` reduces `createBracket`'s parameters to effectively `any`; named type imports like `Data`/`Match` fail with "declares X locally, but it is not exported"). **Never `import type` from `"bracketry"`.** This project's own interfaces in `src/lib/bracketryTypes.ts` are the source of truth for the data/options shape we construct, matching bracketry's documented (not type-checked) API.
- `bracketry` injects its own `<style>` tag at runtime — there is **no separate CSS file to import**. Do not add a `bracketry/dist/css/...` import anywhere; it does not exist and will fail to resolve.
- Only `winners`/`losers`/`playoff` values of `event_matches.bracket` are elimination (tree) groups; every other value (`round_robin`, `pool_a`, `pool_b`, ...) is a grid group with no round-locking.
- `event_matches.round_number` and `slot_in_round` are both 1-indexed in this database; bracketry's `roundIndex`/`order` are both 0-indexed. Every conversion is `-1` one way, `+1` the other — get this backwards and matches render in the wrong slot.
- Deliberately dropped from this pass, to keep scope achievable (flag if this matters more than expected — both are easy follow-ups): player-profile deep-links (today's `hrefByRegistrationId` on the player-facing page) are not threaded into the new tree/grid card labels (bracketry's titles are plain text; a real `<a>` inside `MatchCardGrid`'s whole-card `<button>` tap target would be invalid nested-interactive HTML) — a name is plain text in the tree/grid, same as bracketry's own convention. Per-match session/court time is likewise dropped from the new card labels and the result sheet; it remains visible via the event's existing "Sessions" list and the "Advanced: edit a match manually" section (Task 9).
- Existing conventions this plan follows: pure functions built test-first (TDD); server actions and page components verified live, not unit-tested (except the one new client-interaction component below, per this project's convention that RTL covers *interaction* bugs); Tailwind classes matching the surrounding code's existing style, not a new design system.

---

## File Structure

```
package.json                                          -- MODIFY: add bracketry@1.1.3
src/lib/bracketryTypes.ts                              -- NEW: our own data/options interfaces
src/lib/bracketryData.ts (+ .test.ts)                  -- NEW: toBracketryData
src/lib/activeRounds.ts (+ .test.ts)                   -- NEW: computeActiveRounds, isMatchTappable
src/app/admin/eventMatchActions.ts                      -- MODIFY: recordMatchResult signature
src/components/bracket/MatchResultSheet.tsx             -- NEW: shared bottom sheet
src/components/bracket/BracketryTreeView.tsx            -- NEW: elimination tree wrapper
src/components/bracket/MatchCardGrid.tsx                -- NEW: round robin/pool grid
src/components/bracket/InteractiveBracket.tsx (+ .test.tsx) -- NEW: orchestrator
src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx -- MODIFY: full rewrite
src/app/events/[eventId]/page.tsx                       -- MODIFY: targeted edit
src/components/MatchCard.tsx                            -- DELETE: no callers left after above
```

---

### Task 1: Install bracketry and define our own type shapes

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/lib/bracketryTypes.ts`

**Interfaces:**
- Produces: `BracketryRound`, `BracketrySetScore`, `BracketrySide`, `BracketryMatch`, `BracketryContestant`, `BracketryData`, `BracketryClickedMatch` — used by every later task that touches bracketry.

- [ ] **Step 1: Install the pinned dependency**

```bash
npm install --save-exact bracketry@1.1.3
```

- [ ] **Step 2: Write the type definitions**

```typescript
// src/lib/bracketryTypes.ts

// bracketry's own shipped .d.ts imports types from an internal path
// ("./lib/data/data") that isn't included in the published npm package --
// `import type {...} from "bracketry"` fails to resolve real types (with
// skipLibCheck on, createBracket's own parameters silently become `any`
// instead of erroring). These interfaces are this project's own source of
// truth for the data/options shape bracketry expects, matching its
// documented API at bracketry.app/data-shape and bracketry.app/click-handlers
// -- always construct values shaped to these interfaces, never rely on a
// type import from the package itself.

export interface BracketryRound {
  name?: string;
}

export interface BracketrySetScore {
  mainScore: number;
  isWinner?: boolean;
}

export interface BracketrySide {
  contestantId?: string;
  scores?: BracketrySetScore[];
  isWinner?: boolean;
}

export interface BracketryMatch {
  roundIndex: number;
  order: number;
  sides: BracketrySide[];
}

export interface BracketryContestant {
  players: { title: string }[];
}

export interface BracketryData {
  rounds: BracketryRound[];
  matches: BracketryMatch[];
  contestants: Record<string, BracketryContestant>;
}

// Shape of the object bracketry's onMatchClick callback passes back --
// only the fields we actually read.
export interface BracketryClickedMatch {
  roundIndex: number;
  order: number;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/bracketryTypes.ts
git commit -m "Add bracketry dependency and our own data-shape types"
```

---

### Task 2: `computeActiveRounds` and `isMatchTappable`

**Files:**
- Create: `src/lib/activeRounds.ts`
- Test: `src/lib/activeRounds.test.ts`

**Interfaces:**
- Consumes: `EventMatch` from `@/lib/matchAdvancement` (existing).
- Produces: `computeActiveRounds(matches: EventMatch[]): Record<string, number>`, `isMatchTappable(match: EventMatch, activeRound: number): boolean` — both consumed by Task 6 (`BracketryTreeView`) and Task 8 (`InteractiveBracket`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/activeRounds.test.ts
import { describe, expect, it } from "vitest";
import { computeActiveRounds, isMatchTappable } from "@/lib/activeRounds";
import type { EventMatch } from "@/lib/matchAdvancement";

function buildMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: "a",
    team_b_registration_id: "b",
    team_a_advances_from_match_id: null,
    team_b_advances_from_match_id: null,
    advancement_type_a: null,
    advancement_type_b: null,
    winner_registration_id: null,
    is_bye: false,
    is_forfeit: false,
    status: "pending",
    ...overrides,
  };
}

describe("computeActiveRounds", () => {
  it("returns round 1 when round 1 has an incomplete match", () => {
    const matches = [buildMatch({ id: "m1", round_number: 1, status: "pending" })];
    expect(computeActiveRounds(matches)).toEqual({ winners: 1 });
  });

  it("returns round 2 once every round-1 match is completed", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 1, slot_in_round: 2, status: "completed" }),
      buildMatch({ id: "m3", round_number: 2, status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2 });
  });

  it("keeps round 2 locked while a sibling round-1 match is still pending, even if a round-2 match already has both teams known", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 1, slot_in_round: 2, status: "pending" }),
      // round 2's own two sources (from a different part of the bracket)
      // already resolved, so it has real teams -- but round 1 as a whole
      // isn't done yet.
      buildMatch({ id: "m3", round_number: 2, team_a_registration_id: "c", team_b_registration_id: "d", status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 1 });
  });

  it("returns the last round when the whole bracket is complete", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 2, status: "completed" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2 });
  });

  it("tracks each bracket group independently", () => {
    const matches = [
      buildMatch({ id: "m1", bracket: "winners", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", bracket: "winners", round_number: 2, status: "pending" }),
      buildMatch({ id: "m3", bracket: "losers", round_number: 1, status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2, losers: 1 });
  });
});

describe("isMatchTappable", () => {
  it("is tappable when it's the active round and both teams are known", () => {
    const match = buildMatch({ round_number: 1, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(true);
  });

  it("is not tappable when the round is past the active round", () => {
    const match = buildMatch({ round_number: 2, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(false);
  });

  it("is not tappable when a team slot is still unknown, even in the active round", () => {
    const match = buildMatch({ round_number: 1, team_b_registration_id: null, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(false);
  });

  it("is always tappable once completed, regardless of round", () => {
    const match = buildMatch({ round_number: 5, status: "completed" });
    expect(isMatchTappable(match, 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/activeRounds.test.ts`
Expected: FAIL — `Cannot find module '@/lib/activeRounds'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/activeRounds.ts
import type { EventMatch } from "@/lib/matchAdvancement";

// Per bracket group (winners/losers/playoff), the earliest round number
// containing at least one non-completed match -- every earlier round is,
// by definition, fully done; every later round is locked. Deliberately
// stricter than "this match's own two team slots are both filled" (which
// the schema already enforces structurally via advancement) -- a whole
// round is held back until every match in the round before it finishes,
// even if one specific match in the new round already has both teams
// known because its own two sources happened to finish early. Only ever
// called with elimination-bracket matches (round_robin/pool groups have
// no locking concept and are never passed in).
export function computeActiveRounds(matches: EventMatch[]): Record<string, number> {
  const byBracket = new Map<string, EventMatch[]>();
  for (const m of matches) {
    const list = byBracket.get(m.bracket) ?? [];
    list.push(m);
    byBracket.set(m.bracket, list);
  }

  const result: Record<string, number> = {};
  for (const [bracket, bracketMatches] of byBracket) {
    const rounds = Array.from(new Set(bracketMatches.map((m) => m.round_number))).sort((a, b) => a - b);
    let active = rounds[rounds.length - 1] ?? 1;
    for (const round of rounds) {
      const roundMatches = bracketMatches.filter((m) => m.round_number === round);
      if (roundMatches.some((m) => m.status !== "completed")) {
        active = round;
        break;
      }
    }
    result[bracket] = active;
  }
  return result;
}

// Whether tapping this match should open the (editable) result sheet in
// interactive mode. A completed match is always tappable (re-editing an
// already-saved score, regardless of round) -- locking only blocks
// *first-time* entry on a match that isn't in the active round yet, or
// whose two team slots aren't both known yet.
export function isMatchTappable(match: EventMatch, activeRound: number): boolean {
  if (match.status === "completed") return true;
  if (!match.team_a_registration_id || !match.team_b_registration_id) return false;
  return match.round_number <= activeRound;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/activeRounds.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activeRounds.ts src/lib/activeRounds.test.ts
git commit -m "Add computeActiveRounds and isMatchTappable"
```

---

### Task 3: `toBracketryData`

**Files:**
- Create: `src/lib/bracketryData.ts`
- Test: `src/lib/bracketryData.test.ts`

**Interfaces:**
- Consumes: `EventMatch` from `@/lib/matchAdvancement`; `BracketryData`/`BracketryMatch` from `@/lib/bracketryTypes` (Task 1).
- Produces: `EventMatchSetRow` (exported — reused by every later task that needs the `event_match_sets` row shape), `toBracketryData(matches: EventMatch[], sets: EventMatchSetRow[], nameByRegistrationId: Map<string, string>): BracketryData` — consumed by Task 6 (`BracketryTreeView`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/bracketryData.test.ts
import { describe, expect, it } from "vitest";
import { toBracketryData } from "@/lib/bracketryData";
import type { EventMatch } from "@/lib/matchAdvancement";

function buildMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: "a",
    team_b_registration_id: "b",
    team_a_advances_from_match_id: null,
    team_b_advances_from_match_id: null,
    advancement_type_a: null,
    advancement_type_b: null,
    winner_registration_id: null,
    is_bye: false,
    is_forfeit: false,
    status: "pending",
    ...overrides,
  };
}

const names = new Map([
  ["a", "Team A"],
  ["b", "Team B"],
]);

describe("toBracketryData", () => {
  it("converts 1-indexed round/slot to 0-indexed roundIndex/order", () => {
    const data = toBracketryData([buildMatch({ round_number: 2, slot_in_round: 3 })], [], names);
    expect(data.matches[0].roundIndex).toBe(1);
    expect(data.matches[0].order).toBe(2);
  });

  it("builds one round entry per distinct round_number present", () => {
    const data = toBracketryData(
      [buildMatch({ id: "m1", round_number: 1 }), buildMatch({ id: "m2", round_number: 2 })],
      [],
      names
    );
    expect(data.rounds).toHaveLength(2);
  });

  it("registers both sides as contestants with the right title", () => {
    const data = toBracketryData([buildMatch({})], [], names);
    expect(data.contestants["a"]).toEqual({ players: [{ title: "Team A" }] });
    expect(data.contestants["b"]).toEqual({ players: [{ title: "Team B" }] });
  });

  it("leaves a side empty (no contestantId) when its registration id is null -- a bye or a not-yet-decided future round", () => {
    const data = toBracketryData([buildMatch({ team_b_registration_id: null })], [], names);
    expect(data.matches[0].sides[1]).toEqual({});
    expect(Object.keys(data.contestants)).toEqual(["a"]);
  });

  it("attaches set scores and per-side isWinner from event_match_sets", () => {
    const data = toBracketryData(
      [buildMatch({ id: "m1", winner_registration_id: "a" })],
      [
        { match_id: "m1", set_number: 1, team_a_points: 21, team_b_points: 15 },
        { match_id: "m1", set_number: 2, team_a_points: 21, team_b_points: 18 },
      ],
      names
    );
    expect(data.matches[0].sides[0].scores).toEqual([
      { mainScore: 21, isWinner: true },
      { mainScore: 21, isWinner: true },
    ]);
    expect(data.matches[0].sides[1].scores).toEqual([
      { mainScore: 15, isWinner: false },
      { mainScore: 18, isWinner: false },
    ]);
    expect(data.matches[0].sides[0].isWinner).toBe(true);
    expect(data.matches[0].sides[1].isWinner).toBe(false);
  });

  it("omits scores entirely for a match with no recorded sets", () => {
    const data = toBracketryData([buildMatch({})], [], names);
    expect(data.matches[0].sides[0].scores).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/bracketryData.test.ts`
Expected: FAIL — `Cannot find module '@/lib/bracketryData'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/bracketryData.ts
import type { EventMatch } from "@/lib/matchAdvancement";
import type { BracketryData, BracketryMatch, BracketrySide } from "@/lib/bracketryTypes";

export interface EventMatchSetRow {
  match_id: string;
  set_number: number;
  team_a_points: number;
  team_b_points: number;
}

function buildSide(
  registrationId: string | null,
  winnerRegistrationId: string | null,
  matchSets: EventMatchSetRow[],
  side: "a" | "b",
  contestantIds: Set<string>
): BracketrySide {
  if (!registrationId) return {};
  contestantIds.add(registrationId);

  const scores = matchSets.map((s) => ({
    mainScore: side === "a" ? s.team_a_points : s.team_b_points,
    isWinner: side === "a" ? s.team_a_points > s.team_b_points : s.team_b_points > s.team_a_points,
  }));

  return {
    contestantId: registrationId,
    ...(scores.length > 0 ? { scores } : {}),
    isWinner: winnerRegistrationId ? winnerRegistrationId === registrationId : undefined,
  };
}

// Converts one bracket group's matches (caller already filtered to a
// single `bracket` value) into bracketry's data shape. round_number and
// slot_in_round are 1-indexed in the database; bracketry's roundIndex and
// order are 0-indexed.
export function toBracketryData(
  matches: EventMatch[],
  sets: EventMatchSetRow[],
  nameByRegistrationId: Map<string, string>
): BracketryData {
  const maxRound = matches.reduce((max, m) => Math.max(max, m.round_number), 0);
  const rounds = Array.from({ length: maxRound }, (_, i) => ({ name: `Round ${i + 1}` }));

  const setsByMatchId = new Map<string, EventMatchSetRow[]>();
  for (const s of sets) {
    const existing = setsByMatchId.get(s.match_id) ?? [];
    existing.push(s);
    setsByMatchId.set(s.match_id, existing);
  }

  const contestantIds = new Set<string>();

  const bracketryMatches: BracketryMatch[] = matches.map((m) => {
    const matchSets = setsByMatchId.get(m.id) ?? [];
    return {
      roundIndex: m.round_number - 1,
      order: m.slot_in_round - 1,
      sides: [
        buildSide(m.team_a_registration_id, m.winner_registration_id, matchSets, "a", contestantIds),
        buildSide(m.team_b_registration_id, m.winner_registration_id, matchSets, "b", contestantIds),
      ],
    };
  });

  const contestants: BracketryData["contestants"] = {};
  for (const id of contestantIds) {
    contestants[id] = { players: [{ title: nameByRegistrationId.get(id) ?? "TBD" }] };
  }

  return { rounds, matches: bracketryMatches, contestants };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/bracketryData.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bracketryData.ts src/lib/bracketryData.test.ts
git commit -m "Add toBracketryData"
```

---

### Task 4: Change `recordMatchResult` from redirect to returned state

**Files:**
- Modify: `src/app/admin/eventMatchActions.ts:171-254`

**Interfaces:**
- Produces: `MatchResultState` (exported), new `recordMatchResult(prevState: MatchResultState | null, formData: FormData): Promise<MatchResultState>` signature — consumed by Task 5 (`MatchResultSheet`, via `useActionState`).

- [ ] **Step 1: Add the `isValidSetScore` import stays, add the new type, and replace the function**

Replace the entire existing `recordMatchResult` function (lines 171-254 today) with:

```typescript
export type MatchResultState = { ok: true; reviewNeeded: string[] } | { ok: false; error: string };

export async function recordMatchResult(
  _prevState: MatchResultState | null,
  formData: FormData
): Promise<MatchResultState> {
  const matchId = String(formData.get("match_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const forfeit = formData.get("forfeit") === "on";
  const forfeitWinner = String(formData.get("forfeit_winner") || "") || null;

  const supabase = await createClient();

  const { data: match } = await supabase.from("event_matches").select("*").eq("id", matchId).single();
  if (!match) {
    throw new Error("Match not found.");
  }

  const { data: event } = await supabase
    .from("events")
    .select("best_of_sets, points_per_set, win_by")
    .eq("id", eventId)
    .single();
  const scoringConfig = { pointsPerSet: event?.points_per_set ?? 21, winBy: event?.win_by ?? 2 };
  const bestOfSets = event?.best_of_sets ?? 3;

  let winnerId: string | null = null;

  if (forfeit) {
    if (!forfeitWinner) {
      return { ok: false, error: "Pick who wins the forfeit." };
    }
    winnerId = forfeitWinner;
  } else {
    const setRows: { match_id: string; set_number: number; team_a_points: number; team_b_points: number }[] = [];
    for (let i = 1; i <= bestOfSets; i++) {
      const a = formData.get(`set_${i}_a`);
      const b = formData.get(`set_${i}_b`);
      if (a === null || b === null || a === "" || b === "") continue;
      const teamAPoints = Number(a);
      const teamBPoints = Number(b);
      if (!isValidSetScore(teamAPoints, teamBPoints, scoringConfig)) {
        return {
          ok: false,
          error: `Set ${i}: not a valid score (first to ${scoringConfig.pointsPerSet}, win by ${scoringConfig.winBy}).`,
        };
      }
      setRows.push({ match_id: matchId, set_number: i, team_a_points: teamAPoints, team_b_points: teamBPoints });
    }
    if (setRows.length === 0) {
      return { ok: false, error: "Enter at least one set's score, or mark a forfeit." };
    }

    winnerId = deriveMatchWinner(setRows, match.team_a_registration_id, match.team_b_registration_id);
    if (!winnerId) {
      return { ok: false, error: "Sets are tied -- can't determine a winner." };
    }

    await supabase.from("event_match_sets").delete().eq("match_id", matchId);
    const { error: setsError } = await supabase.from("event_match_sets").insert(setRows);
    if (setsError) {
      throw new Error(setsError.message);
    }
  }

  const { error } = await supabase
    .from("event_matches")
    .update({ winner_registration_id: winnerId, is_forfeit: forfeit, status: "completed" })
    .eq("id", matchId);
  if (error) {
    throw new Error(error.message);
  }

  const reviewNeeded = await applyAdvancement(
    supabase,
    { ...match, winner_registration_id: winnerId, status: "completed" } as EventMatch,
    eventId
  );

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  return { ok: true, reviewNeeded };
}
```

Nothing else in this file changes — `bracketPath`, `applyAdvancement`, and every other action (`generateBracket`, `regenerateBracket`, `editMatch`, `autoAssignSessions`, `withdrawRegistration`) keep redirecting exactly as they do today.

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all existing tests still pass (this function has no unit tests today, per this codebase's convention of verifying server actions live).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/eventMatchActions.ts
git commit -m "Change recordMatchResult to return state instead of redirecting"
```

Note: after this commit, the admin bracket page's existing form (still using the old `action={recordMatchResult}` directly) will fail to compile/build correctly, since the function signature changed — this is expected and gets fixed in Task 9, which replaces that page entirely. If running the dev server between now and Task 9, expect a type error on that one call site.

---

### Task 5: `MatchResultSheet`

**Files:**
- Create: `src/components/bracket/MatchResultSheet.tsx`

**Interfaces:**
- Consumes: `recordMatchResult`, `MatchResultState` from `@/app/admin/eventMatchActions` (Task 4); `EventMatch` from `@/lib/matchAdvancement`; `EventMatchSetRow` from `@/lib/bracketryData` (Task 3).
- Produces: default-exported `MatchResultSheet` component — consumed by Task 8 (`InteractiveBracket`).

- [ ] **Step 1: Write the component**

```tsx
// src/components/bracket/MatchResultSheet.tsx
"use client";

import { useActionState, useEffect } from "react";
import { recordMatchResult, type MatchResultState } from "@/app/admin/eventMatchActions";
import type { EventMatch } from "@/lib/matchAdvancement";
import type { EventMatchSetRow } from "@/lib/bracketryData";

interface MatchResultSheetProps {
  match: EventMatch;
  eventId: string;
  locationId: string;
  nameByRegistrationId: Map<string, string>;
  existingSets: EventMatchSetRow[];
  bestOfSets: number;
  pointsPerSet: number;
  winBy: number;
  interactive: boolean;
  onClose: () => void;
  onSuccess: (reviewNeeded: string[]) => void;
}

export default function MatchResultSheet({
  match,
  eventId,
  locationId,
  nameByRegistrationId,
  existingSets,
  bestOfSets,
  pointsPerSet,
  winBy,
  interactive,
  onClose,
  onSuccess,
}: MatchResultSheetProps) {
  const [state, formAction, isPending] = useActionState<MatchResultState | null, FormData>(
    recordMatchResult,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onSuccess(state.reviewNeeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const sideAName = nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD";
  const sideBName = nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-300 dark:bg-neutral-700" />
        <p className="text-sm font-medium">
          {sideAName} vs {sideBName}
        </p>

        {!interactive && (
          <div className="mt-3 text-sm">
            {existingSets.length === 0 && (
              <p className="text-gray-600 dark:text-neutral-400">No sets recorded yet.</p>
            )}
            {existingSets.map((s) => (
              <p key={s.set_number}>
                Set {s.set_number}: {s.team_a_points}-{s.team_b_points}
              </p>
            ))}
            {match.is_forfeit && <p className="text-gray-600 dark:text-neutral-400">Forfeit</p>}
            {match.winner_registration_id && (
              <p className="mt-1 font-medium">
                Winner: {nameByRegistrationId.get(match.winner_registration_id)}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded border px-3 py-2 text-sm dark:border-neutral-700"
            >
              Close
            </button>
          </div>
        )}

        {interactive && (
          <form action={formAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="match_id" value={match.id} />
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="location_id" value={locationId} />
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              First to {pointsPerSet}, win by {winBy}
            </p>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="w-10" />
              <span className="w-20 truncate">{sideAName}</span>
              <span className="w-3" />
              <span className="w-20 truncate">{sideBName}</span>
            </div>
            {Array.from({ length: bestOfSets }, (_, i) => i + 1).map((n) => {
              const existing = existingSets.find((s) => s.set_number === n);
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-10">Set {n}</span>
                  <input
                    name={`set_${n}_a`}
                    type="number"
                    min="0"
                    defaultValue={existing?.team_a_points ?? ""}
                    className="w-20 rounded border px-2 py-1"
                  />
                  <span>-</span>
                  <input
                    name={`set_${n}_b`}
                    type="number"
                    min="0"
                    defaultValue={existing?.team_b_points ?? ""}
                    className="w-20 rounded border px-2 py-1"
                  />
                </div>
              );
            })}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="forfeit" defaultChecked={match.is_forfeit} /> Forfeit / walkover instead
            </label>
            <select
              name="forfeit_winner"
              defaultValue={match.is_forfeit ? (match.winner_registration_id ?? "") : ""}
              className="rounded border px-2 py-1 text-xs dark:bg-neutral-900"
            >
              <option value="">Forfeit winner (if checked above)</option>
              {match.team_a_registration_id && (
                <option value={match.team_a_registration_id}>{sideAName}</option>
              )}
              {match.team_b_registration_id && (
                <option value={match.team_b_registration_id}>{sideBName}</option>
              )}
            </select>
            {state?.ok === false && (
              <p className="rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                {state.error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Save Result"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border px-3 py-2 text-xs dark:border-neutral-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/bracket/MatchResultSheet.tsx
git commit -m "Add MatchResultSheet"
```

---

### Task 6: `BracketryTreeView`

**Files:**
- Create: `src/components/bracket/BracketryTreeView.tsx`

**Interfaces:**
- Consumes: `createBracket` from `"bracketry"`; `toBracketryData` (Task 3); `isMatchTappable` (Task 2); `EventMatch` from `@/lib/matchAdvancement`; `BracketryClickedMatch` from `@/lib/bracketryTypes` (Task 1).
- Produces: default-exported `BracketryTreeView` component — consumed by Task 8.

- [ ] **Step 1: Write the component**

```tsx
// src/components/bracket/BracketryTreeView.tsx
"use client";

import { useEffect, useRef } from "react";
import { createBracket } from "bracketry";
import { toBracketryData, type EventMatchSetRow } from "@/lib/bracketryData";
import { isMatchTappable } from "@/lib/activeRounds";
import type { BracketryClickedMatch } from "@/lib/bracketryTypes";
import type { EventMatch } from "@/lib/matchAdvancement";

interface BracketryTreeViewProps {
  matches: EventMatch[];
  sets: EventMatchSetRow[];
  nameByRegistrationId: Map<string, string>;
  activeRound: number;
  interactive: boolean;
  onMatchTap: (match: EventMatch) => void;
}

export default function BracketryTreeView({
  matches,
  sets,
  nameByRegistrationId,
  activeRound,
  interactive,
  onMatchTap,
}: BracketryTreeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReturnType<typeof createBracket> | null>(null);

  // Refs so the click handler set up once at mount always reads the
  // latest props, without needing to recreate (and lose scroll position
  // in) the bracketry instance every time matches/activeRound change.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const activeRoundRef = useRef(activeRound);
  activeRoundRef.current = activeRound;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const onMatchTapRef = useRef(onMatchTap);
  onMatchTapRef.current = onMatchTap;

  useEffect(() => {
    if (!wrapperRef.current) return;
    const data = toBracketryData(matchesRef.current, sets, nameByRegistrationId);
    instanceRef.current = createBracket(data, wrapperRef.current, {
      onMatchClick: (clicked: BracketryClickedMatch) => {
        const match = matchesRef.current.find(
          (m) => m.round_number - 1 === clicked.roundIndex && m.slot_in_round - 1 === clicked.order
        );
        if (!match) return;
        if (interactiveRef.current && !isMatchTappable(match, activeRoundRef.current)) return;
        onMatchTapRef.current(match);
      },
    });
    return () => {
      instanceRef.current?.uninstall();
      instanceRef.current = null;
    };
    // Deliberately empty -- see the refs above for why props changing
    // doesn't need to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.replaceData(toBracketryData(matches, sets, nameByRegistrationId));
  }, [matches, sets, nameByRegistrationId]);

  return <div ref={wrapperRef} style={{ height: "480px" }} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/bracket/BracketryTreeView.tsx
git commit -m "Add BracketryTreeView"
```

---

### Task 7: `MatchCardGrid`

**Files:**
- Create: `src/components/bracket/MatchCardGrid.tsx`

**Interfaces:**
- Consumes: `EventMatch` from `@/lib/matchAdvancement`; `StandingsRow` from `@/lib/standings`.
- Produces: default-exported `MatchCardGrid` component — consumed by Task 8.

- [ ] **Step 1: Write the component**

```tsx
// src/components/bracket/MatchCardGrid.tsx
"use client";

import type { EventMatch } from "@/lib/matchAdvancement";
import type { StandingsRow } from "@/lib/standings";

interface MatchCardGridProps {
  matches: EventMatch[];
  standings: StandingsRow[] | null;
  nameByRegistrationId: Map<string, string>;
  onMatchTap: (match: EventMatch) => void;
}

// Round robin/pool play have no tree shape and no round-locking -- every
// match is always tappable, grouped by round in a plain grid. Visually
// pulls its card look (border/spacing/typography) from the same
// conventions the surrounding admin/player pages already use, so it
// reads as one system with the bracketry-rendered tree next to it.
export default function MatchCardGrid({ matches, standings, nameByRegistrationId, onMatchTap }: MatchCardGridProps) {
  const rounds = Array.from(new Set(matches.map((m) => m.round_number))).sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      {standings && (
        <table className="w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-600 dark:text-neutral-400">
              <th>Team</th>
              <th>W</th>
              <th>L</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.registrationId}>
                <td>{nameByRegistrationId.get(row.registrationId) ?? "Unknown"}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{row.pointDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rounds.map((round) => (
        <div key={round}>
          <p className="mb-2 text-xs font-medium text-gray-600 dark:text-neutral-400">Round {round}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {matches
              .filter((m) => m.round_number === round)
              .map((match) => (
                <button
                  key={match.id}
                  type="button"
                  onClick={() => onMatchTap(match)}
                  className="rounded border border-gray-300 px-3 py-2 text-left text-xs hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p>{nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"}</p>
                  <p>{nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}</p>
                  {match.status === "completed" && match.winner_registration_id && (
                    <p className="mt-1 font-medium">
                      Winner: {nameByRegistrationId.get(match.winner_registration_id)}
                    </p>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/bracket/MatchCardGrid.tsx
git commit -m "Add MatchCardGrid"
```

---

### Task 8: `InteractiveBracket` orchestrator, with RTL tests

**Files:**
- Create: `src/components/bracket/InteractiveBracket.tsx`
- Test: `src/components/bracket/InteractiveBracket.test.tsx`

**Interfaces:**
- Consumes: `computeActiveRounds` (Task 2); `computeStandings` from `@/lib/standings` (existing); `BracketryTreeView` (Task 6); `MatchCardGrid` (Task 7); `MatchResultSheet` (Task 5); `useRouter` from `next/navigation`.
- Produces: default-exported `InteractiveBracket` component, props `{ eventId, locationId, matches, sets, nameByRegistrationId, bestOfSets, pointsPerSet, winBy, interactive, onReviewNeeded? }` — consumed by Task 9 (admin page) and Task 10 (player page).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/bracket/InteractiveBracket.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InteractiveBracket from "./InteractiveBracket";
import type { EventMatch } from "@/lib/matchAdvancement";

let capturedOnMatchClick: ((match: { roundIndex: number; order: number }) => void) | null = null;

vi.mock("bracketry", () => ({
  createBracket: vi.fn((_data, _el, options) => {
    capturedOnMatchClick = options.onMatchClick;
    return { applyMatchesUpdates: vi.fn(), replaceData: vi.fn(), uninstall: vi.fn() };
  }),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/app/admin/eventMatchActions", () => ({
  recordMatchResult: vi.fn(async () => ({ ok: true, reviewNeeded: [] })),
}));

function buildMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: "regA",
    team_b_registration_id: "regB",
    team_a_advances_from_match_id: null,
    team_b_advances_from_match_id: null,
    advancement_type_a: null,
    advancement_type_b: null,
    winner_registration_id: null,
    is_bye: false,
    is_forfeit: false,
    status: "pending",
    ...overrides,
  };
}

const nameByRegistrationId = new Map([
  ["regA", "Team A"],
  ["regB", "Team B"],
  ["regC", "Team C"],
  ["regD", "Team D"],
]);

const defaultProps = {
  eventId: "e1",
  locationId: "l1",
  nameByRegistrationId,
  bestOfSets: 3,
  pointsPerSet: 21,
  winBy: 2,
  interactive: true,
};

beforeEach(() => {
  capturedOnMatchClick = null;
  mockRefresh.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InteractiveBracket", () => {
  it("opens the result sheet when an active-round match is tapped", () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[round1]} sets={[]} />);

    capturedOnMatchClick?.({ roundIndex: 0, order: 0 });

    expect(screen.getByText("Team A vs Team B")).toBeInTheDocument();
  });

  it("does not open the sheet for a match in a locked round", () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    const round2 = buildMatch({
      id: "r2",
      round_number: 2,
      slot_in_round: 1,
      team_a_registration_id: "regC",
      team_b_registration_id: "regD",
      status: "pending",
    });
    render(<InteractiveBracket {...defaultProps} matches={[round1, round2]} sets={[]} />);

    capturedOnMatchClick?.({ roundIndex: 1, order: 0 });

    expect(screen.queryByText("Team C vs Team D")).not.toBeInTheDocument();
  });

  it("closes the sheet and refreshes the router after a successful save", async () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[round1]} sets={[]} />);

    capturedOnMatchClick?.({ roundIndex: 0, order: 0 });
    fireEvent.click(screen.getByText("Save Result"));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByText("Team A vs Team B")).not.toBeInTheDocument();
  });

  it("always opens the sheet for round-robin matches, regardless of round", () => {
    const match = buildMatch({ id: "r1", bracket: "round_robin", round_number: 3, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[match]} sets={[]} />);

    fireEvent.click(screen.getByText("Team A"));

    expect(screen.getByText("Team A vs Team B")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/bracket/InteractiveBracket.test.tsx`
Expected: FAIL — `Cannot find module './InteractiveBracket'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/bracket/InteractiveBracket.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventMatch } from "@/lib/matchAdvancement";
import type { EventMatchSetRow } from "@/lib/bracketryData";
import { computeActiveRounds } from "@/lib/activeRounds";
import { computeStandings } from "@/lib/standings";
import BracketryTreeView from "@/components/bracket/BracketryTreeView";
import MatchCardGrid from "@/components/bracket/MatchCardGrid";
import MatchResultSheet from "@/components/bracket/MatchResultSheet";

const ELIMINATION_BRACKETS = new Set(["winners", "losers", "playoff"]);

interface InteractiveBracketProps {
  eventId: string;
  locationId: string;
  matches: EventMatch[];
  sets: EventMatchSetRow[];
  nameByRegistrationId: Map<string, string>;
  bestOfSets: number;
  pointsPerSet: number;
  winBy: number;
  interactive: boolean;
  onReviewNeeded?: (matchIds: string[]) => void;
}

export default function InteractiveBracket({
  eventId,
  locationId,
  matches,
  sets,
  nameByRegistrationId,
  bestOfSets,
  pointsPerSet,
  winBy,
  interactive,
  onReviewNeeded,
}: InteractiveBracketProps) {
  const router = useRouter();
  const [openMatch, setOpenMatch] = useState<EventMatch | null>(null);

  const activeRounds = computeActiveRounds(matches.filter((m) => ELIMINATION_BRACKETS.has(m.bracket)));
  const bracketGroups = Array.from(new Set(matches.map((m) => m.bracket)));

  return (
    <div className="flex flex-col gap-8">
      {bracketGroups.map((bracket) => {
        const bracketMatches = matches.filter((m) => m.bracket === bracket);
        const isElimination = ELIMINATION_BRACKETS.has(bracket);
        const registrationIdsInBracket = Array.from(
          new Set(
            bracketMatches
              .flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id])
              .filter((id): id is string => Boolean(id))
          )
        );

        return (
          <div key={bracket}>
            <h2 className="mb-2 text-lg font-medium capitalize">{bracket.replace(/_/g, " ")}</h2>
            {isElimination ? (
              <BracketryTreeView
                matches={bracketMatches}
                sets={sets}
                nameByRegistrationId={nameByRegistrationId}
                activeRound={activeRounds[bracket] ?? 1}
                interactive={interactive}
                onMatchTap={setOpenMatch}
              />
            ) : (
              <MatchCardGrid
                matches={bracketMatches}
                standings={computeStandings(bracketMatches, sets, registrationIdsInBracket)}
                nameByRegistrationId={nameByRegistrationId}
                onMatchTap={setOpenMatch}
              />
            )}
          </div>
        );
      })}

      {openMatch && (
        <MatchResultSheet
          match={openMatch}
          eventId={eventId}
          locationId={locationId}
          nameByRegistrationId={nameByRegistrationId}
          existingSets={sets.filter((s) => s.match_id === openMatch.id)}
          bestOfSets={bestOfSets}
          pointsPerSet={pointsPerSet}
          winBy={winBy}
          interactive={interactive}
          onClose={() => setOpenMatch(null)}
          onSuccess={(reviewNeeded) => {
            setOpenMatch(null);
            if (reviewNeeded.length > 0) onReviewNeeded?.(reviewNeeded);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/bracket/InteractiveBracket.test.tsx`
Expected: PASS (4 tests). If `fireEvent.click` on the submit button doesn't trigger the mocked action in this project's jsdom version, replace it with `fireEvent.submit(screen.getByText("Save Result").closest("form")!)` in that one test and re-run.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/bracket/InteractiveBracket.tsx src/components/bracket/InteractiveBracket.test.tsx
git commit -m "Add InteractiveBracket orchestrator"
```

---

### Task 9: Wire into the admin bracket page

**Files:**
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `InteractiveBracket` (Task 8); everything else in this file (queries, `generateBracket`, `regenerateBracket`, `editMatch`, `autoAssignSessions`, `withdrawRegistration`) is unchanged from today.

This removes: the `recordMatchResult` import (no longer called directly here — `MatchResultSheet` calls it), the `computeStandings`/`nextPowerOf2`... **keep `nextPowerOf2`** (still used by the generate-bracket form's byes text) but **remove `computeStandings`** (now computed inside `InteractiveBracket`); the `setsByMatchId` map (only the old inline result form used it); the `result_saved`/`result_error`/`review_needed` query-param banners (that action no longer redirects, so these can never fire); and the entire `bracketsPresent.map(...)` block, replaced by `<InteractiveBracket interactive .../>` plus a secondary "Advanced: edit a match manually" section that keeps today's `editMatch` form working, unchanged, per match.

- [ ] **Step 1: Replace the whole file**

```tsx
// src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateBracket, regenerateBracket, editMatch, autoAssignSessions } from "@/app/admin/eventMatchActions";
import { nextPowerOf2 } from "@/lib/bracketGeneration";
import SuccessBanner from "@/components/SuccessBanner";
import InteractiveBracket from "@/components/bracket/InteractiveBracket";

export default async function AdminBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    bracket_generated?: string;
    bracket_reset?: string;
    match_edited?: string;
    sessions_assigned?: string;
    sessions_total?: string;
    withdrawn?: string;
    generate_error?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, registration_mode, best_of_sets, points_per_set, win_by")
    .eq("id", eventId)
    .eq("location_id", locationId)
    .single();
  if (!event) notFound();

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select("id, status, user_id, display_name, team:event_teams(id, name)")
    .eq("event_id", eventId)
    .neq("status", "cancelled")
    .order("registered_at");

  const { data: allRegistrationsForNames } = await supabase
    .from("event_registrations")
    .select("id, display_name, team:event_teams(name)")
    .eq("event_id", eventId);

  const nameByRegistrationId = new Map(
    (allRegistrationsForNames ?? []).map((r) => {
      const team = Array.isArray(r.team) ? r.team[0] : r.team;
      return [r.id, team?.name ?? r.display_name ?? "Player"];
    })
  );

  const { data: matches } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .order("bracket")
    .order("round_number")
    .order("slot_in_round");

  const { data: sets } = await supabase
    .from("event_match_sets")
    .select("*")
    .in(
      "match_id",
      (matches ?? []).map((m) => m.id).length > 0 ? (matches ?? []).map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]
    );

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId)
    .order("start_time");

  const eliminationBracketSize = nextPowerOf2((registrations ?? []).length);
  const unscheduledCount = (matches ?? []).filter((m) => m.status === "pending" && !m.session_id).length;
  const unusedSessionCount = (sessions ?? []).filter((s) => !(matches ?? []).some((m) => m.session_id === s.id)).length;
  const anyCompleted = (matches ?? []).some((m) => m.status === "completed" && !m.is_bye);

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events/${eventId}`} className="text-sm underline">
        &larr; {event.title}
      </Link>
      <h1 className="mt-4 text-lg font-medium">Bracket</h1>

      {sp.bracket_generated && <SuccessBanner>Bracket generated.</SuccessBanner>}
      {sp.bracket_reset && <SuccessBanner>Bracket reset.</SuccessBanner>}
      {sp.match_edited && <SuccessBanner>Match updated.</SuccessBanner>}
      {sp.withdrawn && <SuccessBanner>Registration withdrawn.</SuccessBanner>}
      {sp.sessions_assigned && (
        <SuccessBanner>
          {sp.sessions_assigned} of {sp.sessions_total} matches assigned to a session.
          {Number(sp.sessions_assigned) < Number(sp.sessions_total)
            ? " The rest need a session assigned manually below."
            : ""}
        </SuccessBanner>
      )}
      {sp.generate_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {sp.generate_error}
        </p>
      )}

      {(!matches || matches.length === 0) && (
        <form action={generateBracket} className="mt-6 flex max-w-md flex-col gap-3">
          <input type="hidden" name="event_id" value={eventId} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Format
            <select name="format" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="pool_play">Pool play</option>
            </select>
          </label>
          <dl className="flex flex-col gap-2 rounded border border-gray-200 p-3 text-xs text-gray-600 dark:border-neutral-800 dark:text-neutral-400">
            <div>
              <dt className="font-medium text-gray-800 dark:text-neutral-200">Single elimination</dt>
              <dd>One loss and you&apos;re out. Fastest format -- good when court time or the day itself is limited.</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-800 dark:text-neutral-200">Double elimination</dt>
              <dd>A loss drops you to a losers bracket instead of eliminating you outright -- you&apos;re out only after a second loss. Takes longer but gives every team a second chance.</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-800 dark:text-neutral-200">Round robin</dt>
              <dd>Every team plays every other team once; standings are ranked by wins. No eliminations -- best for a small group with time to play a full set of matches.</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-800 dark:text-neutral-200">Pool play</dt>
              <dd>Teams are split into pools and round-robin within their own pool. Use this for a larger field where a full round robin across everyone would take too long.</dd>
            </div>
          </dl>
          <label className="flex flex-col gap-1 text-sm">
            Seeding
            <select name="seeding" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="registration_order">Registration order</option>
              <option value="random">Random</option>
              <option value="manual">Manual (set seed numbers below)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Bye handling (single/double elimination only)
            <select name="bye_mode" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="auto">Auto (top seeds get byes)</option>
              <option value="manual">Manual (choose bye seats below)</option>
            </select>
          </label>
          <p className="text-xs text-gray-600 dark:text-neutral-400">
            Registered: {(registrations ?? []).length}. If elimination, the bracket rounds up to{" "}
            {eliminationBracketSize} slots ({eliminationBracketSize - (registrations ?? []).length} byes).
          </p>

          <div>
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              Seed numbers (used only when Seeding is Manual; lower = better seed)
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {(registrations ?? []).map((r, i) => (
                <label key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{nameByRegistrationId.get(r.id)}</span>
                  <input
                    name={`seed_for_${r.id}`}
                    type="number"
                    min="1"
                    defaultValue={i + 1}
                    className="w-16 rounded border px-2 py-1"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              Bye seats (used only when Bye handling is Manual; check exactly{" "}
              {eliminationBracketSize - (registrations ?? []).length} of these seat numbers)
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {Array.from({ length: eliminationBracketSize }, (_, i) => i + 1).map((seatNumber) => (
                <label key={seatNumber} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="bye_seed" value={seatNumber} /> {seatNumber}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              Pool assignment (used only when format is Pool Play)
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {(registrations ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{nameByRegistrationId.get(r.id)}</span>
                  <select name={`pool_for_${r.id}`} defaultValue="pool_a" className="rounded border px-2 py-1 dark:bg-neutral-900">
                    <option value="pool_a">Pool A</option>
                    <option value="pool_b">Pool B</option>
                    <option value="pool_c">Pool C</option>
                    <option value="pool_d">Pool D</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
            Generate Bracket
          </button>
        </form>
      )}

      {matches && matches.length > 0 && (
        <>
          {unscheduledCount > 0 && unusedSessionCount > 0 && (
            <form action={autoAssignSessions} className="mt-4">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border px-3 py-2 text-sm dark:border-neutral-700">
                Auto-assign to sessions ({unscheduledCount} unscheduled, {unusedSessionCount} sessions
                available)
              </button>
            </form>
          )}

          <div className="mt-6">
            <InteractiveBracket
              eventId={eventId}
              locationId={locationId}
              matches={matches ?? []}
              sets={sets ?? []}
              nameByRegistrationId={nameByRegistrationId}
              bestOfSets={event.best_of_sets}
              pointsPerSet={event.points_per_set}
              winBy={event.win_by}
              interactive
            />
          </div>

          {!anyCompleted && (
            <form action={regenerateBracket} className="mt-6">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
                Regenerate Bracket
              </button>
            </form>
          )}

          <details className="mt-8">
            <summary className="w-fit cursor-pointer text-sm underline">Advanced: edit a match manually</summary>
            <p className="mt-1 text-xs text-gray-600 dark:text-neutral-400">
              Directly reassign a match&apos;s sides, winner, or session -- bypasses the normal tap-to-score flow above.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {matches.map((match) => (
                <li key={match.id} className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800">
                  <p className="text-sm">
                    {match.bracket} round {match.round_number} &middot;{" "}
                    {nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                    {nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}
                  </p>
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer text-xs underline">Edit Match</summary>
                    <form
                      key={`${match.team_a_registration_id}-${match.team_b_registration_id}-${match.winner_registration_id}-${match.session_id}-${match.admin_note}-${match.status}`}
                      action={editMatch}
                      className="mt-2 flex max-w-sm flex-col gap-2"
                    >
                      <input type="hidden" name="match_id" value={match.id} />
                      <input type="hidden" name="event_id" value={eventId} />
                      <input type="hidden" name="location_id" value={locationId} />
                      <label className="flex flex-col gap-1 text-xs">
                        Side A
                        <select
                          name="team_a_registration_id"
                          defaultValue={match.team_a_registration_id ?? ""}
                          className="rounded border px-2 py-1 dark:bg-neutral-900"
                        >
                          <option value="">-- none --</option>
                          {(registrations ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {nameByRegistrationId.get(r.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Side B
                        <select
                          name="team_b_registration_id"
                          defaultValue={match.team_b_registration_id ?? ""}
                          className="rounded border px-2 py-1 dark:bg-neutral-900"
                        >
                          <option value="">-- none --</option>
                          {(registrations ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {nameByRegistrationId.get(r.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Winner (leave blank if not decided)
                        <select
                          name="winner_registration_id"
                          defaultValue={match.winner_registration_id ?? ""}
                          className="rounded border px-2 py-1 dark:bg-neutral-900"
                        >
                          <option value="">-- none --</option>
                          {match.team_a_registration_id && (
                            <option value={match.team_a_registration_id}>
                              {nameByRegistrationId.get(match.team_a_registration_id)}
                            </option>
                          )}
                          {match.team_b_registration_id && (
                            <option value={match.team_b_registration_id}>
                              {nameByRegistrationId.get(match.team_b_registration_id)}
                            </option>
                          )}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Session
                        <select
                          name="session_id"
                          defaultValue={match.session_id ?? ""}
                          className="rounded border px-2 py-1 dark:bg-neutral-900"
                        >
                          <option value="">-- none --</option>
                          {(sessions ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label ?? s.start_time}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Admin note (shown to players)
                        <input name="admin_note" defaultValue={match.admin_note ?? ""} className="rounded border px-2 py-1" />
                      </label>
                      <button type="submit" className="w-fit rounded border px-3 py-1.5 text-xs dark:border-neutral-700">
                        Save Changes
                      </button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
```

Note: this drops the "Registrants" section with the "Withdraw" form that lived at the bottom of the old file (it used `withdrawRegistration`, imported but now unused above). That section belongs on the main event admin page already (added in the previous pass — see `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`'s "Registrants" section), not this bracket-specific page; withdrawing mid-bracket (which needs to resolve a pending match by forfeit/substitute) was a bracket-page-specific feature though. **Add it back** as a final section, unchanged from the original file, using the same `registrations` query already run above:

```tsx
      <h2 className="mt-10 text-lg font-medium">Registrants</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {(registrations ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border border-gray-300 px-4 py-2 text-sm dark:border-neutral-800">
            <span>
              {nameByRegistrationId.get(r.id)} ({r.status})
            </span>
            <details>
              <summary className="cursor-pointer text-xs underline">Withdraw</summary>
              <form action={withdrawRegistration} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="registration_id" value={r.id} />
                <input type="hidden" name="event_id" value={eventId} />
                <input type="hidden" name="location_id" value={locationId} />
                <label className="flex items-center gap-1 text-xs">
                  <input type="radio" name="resolution" value="forfeit" defaultChecked /> Opponent advances by forfeit
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input type="radio" name="resolution" value="substitute" /> Substitute a different registration
                </label>
                <select name="substitute_registration_id" className="rounded border px-2 py-1 text-xs dark:bg-neutral-900">
                  <option value="">-- pick substitute --</option>
                  {(registrations ?? [])
                    .filter((other) => other.id !== r.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {nameByRegistrationId.get(other.id)}
                      </option>
                    ))}
                </select>
                <button type="submit" className="w-fit rounded border px-3 py-1.5 text-xs dark:border-neutral-700">
                  Confirm Withdraw
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Place this right before the file's final closing `</div>\n  );\n}` (i.e. it becomes the new last section), and add `withdrawRegistration` back into the `eventMatchActions` import list at the top (it was dropped from the import line above by mistake in Step 1 — the import should read `generateBracket, regenerateBracket, editMatch, autoAssignSessions, withdrawRegistration`).

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx"
git commit -m "Wire InteractiveBracket into the admin bracket page"
```

---

### Task 10: Wire into the player-facing event page, remove `MatchCard`

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`
- Delete: `src/components/MatchCard.tsx`

**Interfaces:**
- Consumes: `InteractiveBracket` (Task 8).

- [ ] **Step 1: Update imports**

Remove these two lines (no longer used on this page):

```tsx
import { computeStandings } from "@/lib/standings";
import MatchCard from "@/components/MatchCard";
```

Add:

```tsx
import InteractiveBracket from "@/components/bracket/InteractiveBracket";
```

- [ ] **Step 2: Replace the bracket-rendering block**

Replace the entire block from `{bracketsPresent.length > 0 && (` through its matching closing `)}` (today spanning from the `<h2 className="mt-6 text-lg font-medium">Bracket</h2>` line through the `!isEliminationTree` list, roughly the last third of the file) with:

```tsx
      {(matches ?? []).length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Bracket</h2>
          <InteractiveBracket
            eventId={eventId}
            locationId={location?.id ?? ""}
            matches={matches ?? []}
            sets={matchSets ?? []}
            nameByRegistrationId={nameByRegistrationId}
            bestOfSets={3}
            pointsPerSet={21}
            winBy={2}
            interactive={false}
          />
        </>
      )}
```

`bestOfSets`/`pointsPerSet`/`winBy` are unused in the non-interactive path (`MatchResultSheet` only renders its form when `interactive` is true) — pass any values; `3`/`21`/`2` keep it self-documenting rather than `0`.

This also removes the now-dead `bracketsPresent` variable computed a few lines above it (`const bracketsPresent = Array.from(new Set((matches ?? []).map((m) => m.bracket)));`) — delete that line too, and the now-unused `hrefByRegistrationId` variable if nothing else on the page still reads it (check with a search first: `hrefByRegistrationId` was also used by the registration-status section higher up on this page for a "you're on Team X" link — if so, **keep** that variable and its query, only removing its use inside the bracket block being replaced).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `hrefByRegistrationId` (or `PlayerNameLink`) becomes fully unused elsewhere on the page, TypeScript's `noUnusedLocals`-equivalent lint (or a plain compile warning) will flag it — remove the now-dead declaration in that case.

- [ ] **Step 4: Delete the now-unused component**

```bash
git rm src/components/MatchCard.tsx
```

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no errors, no references to `MatchCard` remain (`grep -r MatchCard src` returns nothing).

- [ ] **Step 6: Commit**

```bash
git add "src/app/events/[eventId]/page.tsx"
git commit -m "Wire InteractiveBracket into the player event page, remove MatchCard"
```

---

### Task 11: Live verification and STATUS.md

**Files:**
- Modify: `docs/STATUS.md` (append entry)

- [ ] **Step 1: Manual verification, following the spec's plan exactly**

Using the dev server against the seeded test tournament (or a fresh one), work through every item in the spec's "Manual verification plan" section:

1. Generate a single-elim bracket; confirm the tree renders with connector lines, Round 1 is tappable, later rounds show as greyed TBD.
2. Score every Round 1 match; confirm Round 2 becomes tappable only once *all* of Round 1 is done.
3. Edit an already-completed match's score in a way that changes the winner and cascades into an already-completed downstream match; confirm the review-needed banner appears (rendered via `InteractiveBracket`'s `onReviewNeeded` callback — wire a simple banner using it if Task 9 didn't already render one; if it's missing, add a small `useState`-driven yellow banner in the admin bracket page above `<InteractiveBracket>`, matching the old banner's copy/styling, passed as the `onReviewNeeded` prop).
4. Generate a double-elim bracket; confirm winners/losers/playoff each render as their own tree, locking independently.
5. Generate a round-robin bracket; confirm every match is tappable at any time via the card grid, with a working standings table.
6. Enter an invalid score in the sheet; confirm the error shows inline and the sheet stays open with entered values intact.
7. Resize to a narrow/mobile viewport (or the Browser pane's mobile preset); confirm the bottom sheet and horizontal-scroll round navigation both work.
8. Confirm the player-facing event page renders the same tree/grid read-only, with tapping a match opening a view-only sheet.

Fix anything that doesn't match before proceeding.

- [ ] **Step 2: Append a STATUS.md entry**

Follow this project's established format (see recent entries in `docs/STATUS.md` for the exact tone/detail level) — summarize what shipped, the bracketry integration decision and its type-resolution caveat, the round-locking rule, and what was verified live. Reference the spec and this plan by path.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "Document interactive bracket feature in STATUS.md"
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-Review Notes

- **Spec coverage:** bracketry for elimination trees (Task 6), MatchCardGrid for round robin/pool (Task 7), bottom sheet (Task 5), round-based locking (Task 2, wired in Task 6/8), `recordMatchResult` returning state (Task 4), both admin and player pages updated (Tasks 9-10), `MatchCard` removed (Task 10) — every spec section maps to a task.
- **Deliberate trims beyond the spec**, surfaced during file-structure research and called out in Global Constraints rather than silently applied: player-profile deep-links and per-match session/court display are not threaded into the new tree/grid/sheet in this pass.
- **Type consistency checked:** `EventMatchSetRow` (Task 3) is the one shape used everywhere sets are passed (Tasks 5-9); `MatchResultState` (Task 4) matches exactly what `MatchResultSheet` (Task 5) destructures; `InteractiveBracket`'s prop names match what Tasks 9 and 10 pass in.
