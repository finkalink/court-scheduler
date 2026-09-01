# Special Events — Brackets (Plan 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let events generate real brackets from their registered
teams/individuals (single-elim, double-elim, round robin, pool play),
record results, auto-advance winners, compute standings, and show both to
players — including a league's weekly regular season and a subsequent
multi-week playoff bracket, not just a same-day tournament.

**Architecture:** One new table (`event_matches`) holds every format via a
generic `bracket`/`round_number`/`slot_in_round` shape with self-referencing
advancement links, plus `event_match_sets` for per-set scores. Four pure
generation functions (single-elim, double-elim, round robin, pool play)
build a match graph in memory with client-generated UUIDs before a single
insert. A pure advancement function propagates a completed match's
winner/loser into whatever match references it. A pure standings function
computes win/loss + point differential on the fly, matching this codebase's
"compute, don't store" convention. Matches can optionally link to one of an
event's existing `event_sessions` rows (manual, or a one-click ordered
auto-assign) so a league's matches carry real week/court info.

**Tech Stack:** Next.js server components/actions, Supabase Postgres + RLS,
Tailwind CSS, Vitest for the pure-logic modules.

**Spec:** `docs/superpowers/specs/2026-08-31-special-events-brackets-design.md`
— this plan implements Future Decomposition item 3 from
`docs/superpowers/specs/2026-08-30-special-events-design.md`, building on
the already-shipped core events/sessions (Plan 1) and
registration/teams/waitlist (Plan 2, `supabase/migrations/0017-0019`).

## Global Constraints

- No per-match court/time *booking* — a match's `session_id` only points at
  an `event_sessions` row that already exists and already blocks its court
  time via `bookings`. Nothing in this plan creates, moves, or resizes a
  session.
- No capacity-aware auto-scheduler — `pairMatchesToSessions` is a simple
  ordered zip (round order → session start-time order), not a scheduler
  that understands multiple simultaneous courts. Leftover matches or
  sessions are left for manual assignment via Edit Match.
- No general user-profile system — individual registrations get one new
  `display_name` column, nothing more.
- No automatic pool → playoff promotion — an admin reads the standings
  table and manually generates a follow-up bracket from whichever
  registrations they choose.
- No bracket-reset grand final for double-elimination — the losers-bracket
  finalist plays the winners-bracket champion exactly once.
- Three-plus-way standings ties fall through to point differential only;
  head-to-head tie-breaking applies only to an exact two-way tie.
- No tests for page components or server actions (this codebase's
  established convention) — only the `src/lib` pure functions are
  unit-tested, test-first.
- Double-elimination requires a bracket size (after bye-padding) of at
  least 4 — a 2-team double-elim bracket has no losers bracket to build and
  is out of scope; the admin should use single-elim for that case.

---

### Task 1: Migration — `event_matches`, `event_match_sets`, `display_name`, RLS

**Files:**
- Create: `supabase/migrations/0020_event_brackets.sql`

**Interfaces:**
- Produces: `event_matches`, `event_match_sets` tables;
  `event_registrations.display_name` column.

- [ ] **Step 1: Write the migration**

```sql
-- Special events, Plan 3: brackets. Layers on top of
-- events/event_sessions (0015/0016) and event_registrations/event_teams
-- (0017-0019). Payment integration is a separate future migration.

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
  is_bye boolean not null default false,
  is_forfeit boolean not null default false,
  admin_note text,
  session_id uuid references event_sessions(id),
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'completed'))
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

alter table event_matches enable row level security;
alter table event_match_sets enable row level security;

-- Public read (non-sensitive schedule/result data, same tier as
-- events/event_sessions/event_teams). Write requires org membership --
-- staff included, matching every other day-to-day scheduling table.
create policy "event_matches select all" on event_matches
  for select using (true);
create policy "event_matches write member" on event_matches
  for insert with check (public.is_org_member(public.org_id_for_event(event_id)));
create policy "event_matches update member" on event_matches
  for update using (public.is_org_member(public.org_id_for_event(event_id)));
create policy "event_matches delete member" on event_matches
  for delete using (public.is_org_member(public.org_id_for_event(event_id)));

create policy "event_match_sets select all" on event_match_sets
  for select using (true);
create policy "event_match_sets write member" on event_match_sets
  for insert with check (
    public.is_org_member(public.org_id_for_event(
      (select event_id from event_matches where id = match_id)
    ))
  );
create policy "event_match_sets delete member" on event_match_sets
  for delete using (
    public.is_org_member(public.org_id_for_event(
      (select event_id from event_matches where id = match_id)
    ))
  );
-- No update policy on event_match_sets: correcting a set's score is
-- delete-and-reinsert (see Task 8's recordMatchResult/editMatch), not an
-- in-place row edit -- same insert-or-delete convention as blocked_slots.

create index event_matches_event_idx on event_matches (event_id, bracket, round_number);
create index event_matches_session_idx on event_matches (session_id);
create index event_match_sets_match_idx on event_match_sets (match_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0020_event_brackets.sql`

- [ ] **Step 3: Verify against the live database**

Confirm both tables and the `display_name` column exist. As a staff
account, insert a minimal `event_matches` row for a seeded event and
confirm it succeeds; confirm an anonymous read of that row succeeds and an
anonymous insert attempt is rejected.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0020_event_brackets.sql
git commit -m "Add event_matches/event_match_sets tables and registration display_name"
```

---

### Task 2: Pure logic — match advancement propagation

**Files:**
- Create: `src/lib/matchAdvancement.ts`
- Create: `src/lib/matchAdvancement.test.ts`

**Interfaces:**
- Produces: `EventMatch`, `MatchStatus`, `AdvancementType` types;
  `propagateAdvancement(completedMatch, allMatches)` (consumed by Tasks 3,
  4, 8, 9).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/matchAdvancement.test.ts
import { describe, expect, it } from "vitest";
import { propagateAdvancement, type EventMatch } from "@/lib/matchAdvancement";

function baseMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: null,
    team_b_registration_id: null,
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

describe("propagateAdvancement", () => {
  it("fills a downstream match's slot with the winner", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const downstream = baseMatch({
      id: "m2",
      round_number: 2,
      team_a_advances_from_match_id: "m1",
      advancement_type_a: "winner",
    });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, downstream]);

    expect(updatedMatches).toHaveLength(1);
    expect(updatedMatches[0].id).toBe("m2");
    expect(updatedMatches[0].team_a_registration_id).toBe("regA");
    expect(secondHopWarnings).toHaveLength(0);
  });

  it("fills a losers-bracket slot with the loser", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const losersMatch = baseMatch({
      id: "lm1",
      bracket: "losers",
      team_b_advances_from_match_id: "m1",
      advancement_type_b: "loser",
    });

    const { updatedMatches } = propagateAdvancement(completed, [completed, losersMatch]);

    expect(updatedMatches[0].team_b_registration_id).toBe("regB");
  });

  it("flags an already-completed downstream match instead of overwriting it", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const downstream = baseMatch({
      id: "m2",
      team_a_advances_from_match_id: "m1",
      advancement_type_a: "winner",
      team_a_registration_id: "regA",
      team_b_registration_id: "regC",
      winner_registration_id: "regC",
      status: "completed",
    });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, downstream]);

    expect(updatedMatches).toHaveLength(0);
    expect(secondHopWarnings).toHaveLength(1);
    expect(secondHopWarnings[0].id).toBe("m2");
  });

  it("does nothing when no match references the completed one", () => {
    const completed = baseMatch({ id: "m1", winner_registration_id: "regA", status: "completed" });
    const unrelated = baseMatch({ id: "m2" });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, unrelated]);

    expect(updatedMatches).toHaveLength(0);
    expect(secondHopWarnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- matchAdvancement`
Expected: FAIL with "Cannot find module '@/lib/matchAdvancement'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/matchAdvancement.ts
export type MatchStatus = "pending" | "scheduled" | "completed";
export type AdvancementType = "winner" | "loser";

export interface EventMatch {
  id: string;
  event_id: string;
  bracket: string;
  round_number: number;
  slot_in_round: number;
  team_a_registration_id: string | null;
  team_b_registration_id: string | null;
  team_a_advances_from_match_id: string | null;
  team_b_advances_from_match_id: string | null;
  advancement_type_a: AdvancementType | null;
  advancement_type_b: AdvancementType | null;
  winner_registration_id: string | null;
  is_bye: boolean;
  is_forfeit: boolean;
  status: MatchStatus;
}

export interface AdvancementResult {
  updatedMatches: EventMatch[];
  secondHopWarnings: EventMatch[];
}

function loserOf(match: EventMatch): string | null {
  if (!match.winner_registration_id) return null;
  if (match.team_a_registration_id === match.winner_registration_id) {
    return match.team_b_registration_id;
  }
  if (match.team_b_registration_id === match.winner_registration_id) {
    return match.team_a_registration_id;
  }
  return null;
}

// Finds every match referencing `completedMatch` via its advancement
// links and fills the referencing slot with the winner (or loser, for a
// losers-bracket drop-in link). A downstream match that's already
// `completed` is left untouched and reported in `secondHopWarnings`
// instead of being silently overwritten -- multi-hop corrections are an
// explicit admin task, not an automatic cascade (see the design spec's
// "Correction cascade" decision).
export function propagateAdvancement(
  completedMatch: EventMatch,
  allMatches: EventMatch[]
): AdvancementResult {
  const updatedMatches: EventMatch[] = [];
  const secondHopWarnings: EventMatch[] = [];

  for (const match of allMatches) {
    if (match.id === completedMatch.id) continue;

    let next = match;
    let touched = false;
    let flagged = false;

    if (match.team_a_advances_from_match_id === completedMatch.id) {
      if (match.status === "completed") {
        flagged = true;
      } else {
        const advancer =
          match.advancement_type_a === "loser" ? loserOf(completedMatch) : completedMatch.winner_registration_id;
        next = { ...next, team_a_registration_id: advancer };
        touched = true;
      }
    }

    if (match.team_b_advances_from_match_id === completedMatch.id) {
      if (match.status === "completed") {
        flagged = true;
      } else {
        const advancer =
          match.advancement_type_b === "loser" ? loserOf(completedMatch) : completedMatch.winner_registration_id;
        next = { ...next, team_b_registration_id: advancer };
        touched = true;
      }
    }

    if (touched) updatedMatches.push(next);
    if (flagged) secondHopWarnings.push(match);
  }

  return { updatedMatches, secondHopWarnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- matchAdvancement`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/matchAdvancement.ts src/lib/matchAdvancement.test.ts
git commit -m "Add match advancement propagation, test-first"
```

---

### Task 3: Pure logic — single & double elimination bracket generation

**Files:**
- Create: `src/lib/bracketGeneration.ts`
- Create: `src/lib/bracketGeneration.test.ts`

**Interfaces:**
- Consumes: `EventMatch`, `propagateAdvancement` from Task 2.
- Produces: `SeedSlot`, `nextPowerOf2`, `seedOrder`,
  `generateSingleElimBracket`, `generateDoubleElimBracket` (consumed by
  Task 7).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/bracketGeneration.test.ts
import { describe, expect, it } from "vitest";
import {
  nextPowerOf2,
  seedOrder,
  generateSingleElimBracket,
  generateDoubleElimBracket,
  type SeedSlot,
} from "@/lib/bracketGeneration";

describe("nextPowerOf2", () => {
  it("rounds up to the next power of 2", () => {
    expect(nextPowerOf2(1)).toBe(1);
    expect(nextPowerOf2(2)).toBe(2);
    expect(nextPowerOf2(3)).toBe(4);
    expect(nextPowerOf2(6)).toBe(8);
    expect(nextPowerOf2(8)).toBe(8);
    expect(nextPowerOf2(9)).toBe(16);
  });
});

describe("seedOrder", () => {
  it("produces the standard bracket seeding order", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

function seeds(ids: (string | null)[]): SeedSlot[] {
  return ids.map((registrationId, i) => ({ registrationId, seed: i + 1 }));
}

describe("generateSingleElimBracket", () => {
  it("generates one round-1 match for a 2-team bracket", () => {
    const matches = generateSingleElimBracket(seeds(["a", "b"]), "e1");
    expect(matches).toHaveLength(1);
    expect(matches[0].round_number).toBe(1);
    expect(matches[0].team_a_registration_id).toBe("a");
    expect(matches[0].team_b_registration_id).toBe("b");
    expect(matches[0].status).toBe("pending");
  });

  it("generates 3 matches across 2 rounds for a 4-team bracket, round 2 unfilled", () => {
    const matches = generateSingleElimBracket(seeds(["a", "b", "c", "d"]), "e1");
    expect(matches).toHaveLength(3);
    const round1 = matches.filter((m) => m.round_number === 1);
    const round2 = matches.filter((m) => m.round_number === 2);
    expect(round1).toHaveLength(2);
    expect(round2).toHaveLength(1);
    expect(round2[0].team_a_registration_id).toBeNull();
    expect(round2[0].team_a_advances_from_match_id).toBe(round1[0].id);
    expect(round2[0].team_b_advances_from_match_id).toBe(round1[1].id);
  });

  it("auto-completes a bye match and propagates the winner into round 2", () => {
    // 3 real teams padded to a 4-slot bracket; seed 4 is a bye.
    const matches = generateSingleElimBracket(seeds(["a", "b", "c", null]), "e1");
    const round1 = matches.filter((m) => m.round_number === 1);
    const byeMatch = round1.find((m) => m.is_bye);
    expect(byeMatch).toBeDefined();
    expect(byeMatch!.status).toBe("completed");
    expect(byeMatch!.winner_registration_id).not.toBeNull();

    const round2 = matches.find((m) => m.round_number === 2)!;
    const feedsFromBye =
      round2.team_a_advances_from_match_id === byeMatch!.id
        ? round2.team_a_registration_id
        : round2.team_b_registration_id;
    expect(feedsFromBye).toBe(byeMatch!.winner_registration_id);
  });
});

describe("generateDoubleElimBracket", () => {
  it("throws for a bracket smaller than 4", () => {
    expect(() => generateDoubleElimBracket(seeds(["a", "b"]), "e1")).toThrow();
  });

  it("generates the full winners + losers + grand-final structure for 4 teams", () => {
    const matches = generateDoubleElimBracket(seeds(["a", "b", "c", "d"]), "e1");
    const winners = matches.filter((m) => m.bracket === "winners");
    const losers = matches.filter((m) => m.bracket === "losers");
    const playoff = matches.filter((m) => m.bracket === "playoff");

    expect(winners).toHaveLength(3); // 2 round-1 + 1 final
    expect(losers).toHaveLength(2); // N - 2
    expect(playoff).toHaveLength(1); // grand final

    const grandFinal = playoff[0];
    const winnersFinal = winners.find((m) => m.round_number === 2)!;
    const losersFinal = losers.reduce((a, b) => (a.round_number > b.round_number ? a : b));
    expect(grandFinal.team_a_advances_from_match_id).toBe(winnersFinal.id);
    expect(grandFinal.team_b_advances_from_match_id).toBe(losersFinal.id);
    expect(grandFinal.advancement_type_a).toBe("winner");
    expect(grandFinal.advancement_type_b).toBe("winner"); // winner OF the losers bracket
  });

  it("generates 6 losers-bracket matches for an 8-team bracket (N - 2)", () => {
    const matches = generateDoubleElimBracket(
      seeds(["a", "b", "c", "d", "e", "f", "g", "h"]),
      "e1"
    );
    const losers = matches.filter((m) => m.bracket === "losers");
    expect(losers).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- bracketGeneration`
Expected: FAIL with "Cannot find module '@/lib/bracketGeneration'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/bracketGeneration.ts
import { propagateAdvancement, type EventMatch } from "@/lib/matchAdvancement";

export interface SeedSlot {
  registrationId: string | null; // null = bye
  seed: number; // 1-indexed, best seed = 1
}

export function nextPowerOf2(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// Standard recursive tournament seeding order: seedOrder(2N) interleaves
// seedOrder(N) with its mirror (2N + 1 - seed). E.g. seedOrder(8) pairs
// round 1 as (1v8, 4v5, 2v7, 3v6).
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  const prev = seedOrder(size / 2);
  const result: number[] = [];
  for (const s of prev) {
    result.push(s);
    result.push(size + 1 - s);
  }
  return result;
}

// Any bye match generated at round 1 is already `completed`; walk those
// and propagate their winner into round 2 immediately, so a generated
// bracket never sits with an already-decided slot left empty.
function applyByePropagation(matches: EventMatch[]): EventMatch[] {
  let current = matches;
  for (const match of matches.filter((m) => m.is_bye)) {
    const { updatedMatches } = propagateAdvancement(match, current);
    if (updatedMatches.length === 0) continue;
    const byId = new Map(updatedMatches.map((m) => [m.id, m]));
    current = current.map((m) => byId.get(m.id) ?? m);
  }
  return current;
}

function buildWinnersRounds(
  seeds: SeedSlot[],
  eventId: string
): { matches: EventMatch[]; roundsMatchIds: string[][] } {
  const bracketSize = seeds.length;
  const order = seedOrder(bracketSize);
  const bySeed = new Map(seeds.map((s) => [s.seed, s]));
  const matches: EventMatch[] = [];
  const roundsMatchIds: string[][] = [];

  let roundIds: string[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const slotA = bySeed.get(order[i * 2])!;
    const slotB = bySeed.get(order[i * 2 + 1])!;
    const isBye = slotA.registrationId === null || slotB.registrationId === null;
    const id = crypto.randomUUID();
    matches.push({
      id,
      event_id: eventId,
      bracket: "winners",
      round_number: 1,
      slot_in_round: i + 1,
      team_a_registration_id: slotA.registrationId,
      team_b_registration_id: slotB.registrationId,
      team_a_advances_from_match_id: null,
      team_b_advances_from_match_id: null,
      advancement_type_a: null,
      advancement_type_b: null,
      winner_registration_id: isBye ? slotA.registrationId ?? slotB.registrationId : null,
      is_bye: isBye,
      is_forfeit: false,
      status: isBye ? "completed" : "pending",
    });
    roundIds.push(id);
  }
  roundsMatchIds.push(roundIds);

  let round = 1;
  while (roundIds.length > 1) {
    round += 1;
    const nextRoundIds: string[] = [];
    for (let i = 0; i < roundIds.length / 2; i++) {
      const id = crypto.randomUUID();
      matches.push({
        id,
        event_id: eventId,
        bracket: "winners",
        round_number: round,
        slot_in_round: i + 1,
        team_a_registration_id: null,
        team_b_registration_id: null,
        team_a_advances_from_match_id: roundIds[i * 2],
        team_b_advances_from_match_id: roundIds[i * 2 + 1],
        advancement_type_a: "winner",
        advancement_type_b: "winner",
        winner_registration_id: null,
        is_bye: false,
        is_forfeit: false,
        status: "pending",
      });
      nextRoundIds.push(id);
    }
    roundIds = nextRoundIds;
    roundsMatchIds.push(roundIds);
  }

  return { matches, roundsMatchIds };
}

export function generateSingleElimBracket(seeds: SeedSlot[], eventId: string): EventMatch[] {
  const { matches } = buildWinnersRounds(seeds, eventId);
  return applyByePropagation(matches);
}

// Builds the winners bracket (as generateSingleElimBracket does), then a
// losers bracket fed by each winners round's losers, then a single grand
// final. Losers-bracket construction alternates "drop-in" rounds (new
// winners-round losers paired against losers-bracket survivors) and
// "consolidation" rounds (survivors paired against each other) -- the
// standard structure used by most bracket generators. Round 1 is a
// special case of a drop-in round with no prior survivors, so it just
// pairs winners round 1's losers among themselves.
//
// Known simplification: pairing is by array index, not rematch-avoiding
// seeding -- acceptable for this plan (see the design spec's non-goals).
// A winners-bracket bye's "loser" is null (nobody to lose), which
// propagates as a null slot into the losers bracket; if that leaves a
// losers-bracket match with only one real side, the admin resolves it via
// Edit Match (Task 8) same as any other manual correction.
export function generateDoubleElimBracket(seeds: SeedSlot[], eventId: string): EventMatch[] {
  const bracketSize = seeds.length;
  if (bracketSize < 4) {
    throw new Error("Double elimination requires a bracket size of at least 4.");
  }

  const { matches, roundsMatchIds } = buildWinnersRounds(seeds, eventId);
  const winnersRounds = roundsMatchIds.length;

  function pairSelf(ids: string[], lrRound: number): string[] {
    const nextIds: string[] = [];
    for (let i = 0; i < ids.length / 2; i++) {
      const id = crypto.randomUUID();
      matches.push({
        id,
        event_id: eventId,
        bracket: "losers",
        round_number: lrRound,
        slot_in_round: i + 1,
        team_a_registration_id: null,
        team_b_registration_id: null,
        team_a_advances_from_match_id: ids[i * 2],
        team_b_advances_from_match_id: ids[i * 2 + 1],
        advancement_type_a: "winner",
        advancement_type_b: "winner",
        winner_registration_id: null,
        is_bye: false,
        is_forfeit: false,
        status: "pending",
      });
      nextIds.push(id);
    }
    return nextIds;
  }

  function pairAcross(survivorIds: string[], dropIds: string[], lrRound: number): string[] {
    const nextIds: string[] = [];
    for (let i = 0; i < survivorIds.length; i++) {
      const id = crypto.randomUUID();
      matches.push({
        id,
        event_id: eventId,
        bracket: "losers",
        round_number: lrRound,
        slot_in_round: i + 1,
        team_a_registration_id: null,
        team_b_registration_id: null,
        team_a_advances_from_match_id: survivorIds[i],
        team_b_advances_from_match_id: dropIds[i],
        advancement_type_a: "winner",
        advancement_type_b: "loser",
        winner_registration_id: null,
        is_bye: false,
        is_forfeit: false,
        status: "pending",
      });
      nextIds.push(id);
    }
    return nextIds;
  }

  let survivors: string[] | null = null;
  let lrRound = 0;
  for (let k = 1; k <= winnersRounds - 1; k++) {
    const drop = roundsMatchIds[k - 1]; // winners round k's match ids -- each match's loser drops in
    if (survivors === null) {
      lrRound += 1;
      survivors = pairSelf(drop, lrRound);
    } else {
      lrRound += 1;
      const afterDropIn = pairAcross(survivors, drop, lrRound);
      if (afterDropIn.length > 1) {
        lrRound += 1;
        survivors = pairSelf(afterDropIn, lrRound);
      } else {
        survivors = afterDropIn;
      }
    }
  }

  const winnersFinalId = roundsMatchIds[winnersRounds - 1][0];
  lrRound += 1;
  const losersChampionId = crypto.randomUUID();
  matches.push({
    id: losersChampionId,
    event_id: eventId,
    bracket: "losers",
    round_number: lrRound,
    slot_in_round: 1,
    team_a_registration_id: null,
    team_b_registration_id: null,
    team_a_advances_from_match_id: survivors![0],
    team_b_advances_from_match_id: winnersFinalId,
    advancement_type_a: "winner",
    advancement_type_b: "loser",
    winner_registration_id: null,
    is_bye: false,
    is_forfeit: false,
    status: "pending",
  });

  const grandFinalId = crypto.randomUUID();
  matches.push({
    id: grandFinalId,
    event_id: eventId,
    bracket: "playoff",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: null,
    team_b_registration_id: null,
    team_a_advances_from_match_id: winnersFinalId,
    team_b_advances_from_match_id: losersChampionId,
    advancement_type_a: "winner",
    advancement_type_b: "winner", // the winner OF the losers bracket, not a loser advancing further
    winner_registration_id: null,
    is_bye: false,
    is_forfeit: false,
    status: "pending",
  });

  return applyByePropagation(matches);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- bracketGeneration`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/bracketGeneration.ts src/lib/bracketGeneration.test.ts
git commit -m "Add single and double elimination bracket generation, test-first"
```

---

### Task 4: Pure logic — round robin & pool play generation

**Files:**
- Modify: `src/lib/bracketGeneration.ts`
- Modify: `src/lib/bracketGeneration.test.ts`

**Interfaces:**
- Produces: `generateRoundRobinMatches`, `generatePoolPlayMatches`
  (consumed by Task 7).

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/bracketGeneration.test.ts`:

```ts
import { generateRoundRobinMatches, generatePoolPlayMatches } from "@/lib/bracketGeneration";

describe("generateRoundRobinMatches", () => {
  it("generates every pair exactly once for 4 teams", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c", "d"], "e1");
    expect(matches).toHaveLength(6); // C(4,2)

    const pairs = new Set(
      matches.map((m) => [m.team_a_registration_id, m.team_b_registration_id].sort().join("|"))
    );
    expect(pairs.size).toBe(6);
  });

  it("groups matches into rounds where no team repeats", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c", "d"], "e1");
    const byRound = new Map<number, string[]>();
    for (const m of matches) {
      const list = byRound.get(m.round_number) ?? [];
      list.push(m.team_a_registration_id!, m.team_b_registration_id!);
      byRound.set(m.round_number, list);
    }
    for (const ids of byRound.values()) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("handles an odd number of teams with a bye week (no crash, correct match count)", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c"], "e1");
    expect(matches).toHaveLength(3); // C(3,2)
  });

  it("labels matches with a custom bracket name", () => {
    const matches = generateRoundRobinMatches(["a", "b"], "e1", "pool_a");
    expect(matches[0].bracket).toBe("pool_a");
  });
});

describe("generatePoolPlayMatches", () => {
  it("generates independent round robins per pool", () => {
    const matches = generatePoolPlayMatches({ pool_a: ["a", "b"], pool_b: ["c", "d", "e"] }, "e1");
    const poolA = matches.filter((m) => m.bracket === "pool_a");
    const poolB = matches.filter((m) => m.bracket === "pool_b");
    expect(poolA).toHaveLength(1);
    expect(poolB).toHaveLength(3); // C(3,2)
    for (const m of poolA) {
      expect(["a", "b"]).toContain(m.team_a_registration_id);
      expect(["a", "b"]).toContain(m.team_b_registration_id);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- bracketGeneration`
Expected: FAIL — `generateRoundRobinMatches`/`generatePoolPlayMatches` not exported

- [ ] **Step 3: Add the implementation**

Append to `src/lib/bracketGeneration.ts`:

```ts
const BYE_PLACEHOLDER = "__bye__";

// Standard round-robin "circle method": one item is fixed, the rest
// rotate one position each round; each round pairs position i with
// position (n-1-i). Produces n-1 rounds (or n rounds if n is odd, via the
// caller's bye placeholder) where no item repeats within a round.
function circlePairings(items: string[]): string[][][] {
  const n = items.length;
  const fixed = items[0];
  let rest = items.slice(1);
  const rounds: string[][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const arranged = [fixed, ...rest];
    const pairs: string[][] = [];
    for (let i = 0; i < n / 2; i++) {
      pairs.push([arranged[i], arranged[n - 1 - i]]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }

  return rounds;
}

export function generateRoundRobinMatches(
  registrationIds: string[],
  eventId: string,
  bracket: string = "round_robin"
): EventMatch[] {
  const items = registrationIds.length % 2 === 0 ? registrationIds : [...registrationIds, BYE_PLACEHOLDER];
  const rounds = circlePairings(items);
  const matches: EventMatch[] = [];

  rounds.forEach((pairs, roundIndex) => {
    let slot = 1;
    for (const [a, b] of pairs) {
      if (a === BYE_PLACEHOLDER || b === BYE_PLACEHOLDER) continue; // a bye week, not a match
      matches.push({
        id: crypto.randomUUID(),
        event_id: eventId,
        bracket,
        round_number: roundIndex + 1,
        slot_in_round: slot,
        team_a_registration_id: a,
        team_b_registration_id: b,
        team_a_advances_from_match_id: null,
        team_b_advances_from_match_id: null,
        advancement_type_a: null,
        advancement_type_b: null,
        winner_registration_id: null,
        is_bye: false,
        is_forfeit: false,
        status: "pending",
      });
      slot += 1;
    }
  });

  return matches;
}

export function generatePoolPlayMatches(
  pools: Record<string, string[]>,
  eventId: string
): EventMatch[] {
  return Object.entries(pools).flatMap(([poolLabel, registrationIds]) =>
    generateRoundRobinMatches(registrationIds, eventId, poolLabel)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- bracketGeneration`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/bracketGeneration.ts src/lib/bracketGeneration.test.ts
git commit -m "Add round robin and pool play match generation, test-first"
```

---

### Task 5: Pure logic — standings computation

**Files:**
- Create: `src/lib/standings.ts`
- Create: `src/lib/standings.test.ts`

**Interfaces:**
- Consumes: `EventMatch` from Task 2.
- Produces: `EventMatchSet`, `StandingsRow`, `computeStandings` (consumed
  by Tasks 10, 12).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/standings.test.ts
import { describe, expect, it } from "vitest";
import { computeStandings, type EventMatchSet } from "@/lib/standings";
import type { EventMatch } from "@/lib/matchAdvancement";

function match(overrides: Partial<EventMatch> & { id: string }): EventMatch {
  return {
    event_id: "e1",
    bracket: "round_robin",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: null,
    team_b_registration_id: null,
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

describe("computeStandings", () => {
  it("ranks by win percentage", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "a", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "a", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
      match({ id: "m3", team_a_registration_id: "b", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
    ];
    const rows = computeStandings(matches, [], ["a", "b", "c"]);
    expect(rows.map((r) => r.registrationId)).toEqual(["c", "a", "b"]);
    expect(rows[0].wins).toBe(2);
    expect(rows[0].losses).toBe(0);
  });

  it("breaks a win-percentage tie by point differential", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "a", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "c", team_b_registration_id: "b", winner_registration_id: "c", status: "completed" }),
    ];
    const sets: EventMatchSet[] = [
      { match_id: "m1", set_number: 1, team_a_points: 21, team_b_points: 5 },
      { match_id: "m2", set_number: 1, team_a_points: 21, team_b_points: 19 },
    ];
    const rows = computeStandings(matches, sets, ["a", "b", "c"]);
    expect(rows[0].registrationId).toBe("a"); // same 1-0 record as c, bigger point diff
    expect(rows[0].pointDiff).toBe(16);
  });

  it("breaks an exact two-way tie by head-to-head result", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "b", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "a", team_b_registration_id: "c", winner_registration_id: "a", status: "completed" }),
      match({ id: "m3", team_a_registration_id: "b", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
    ];
    // a: 1-1, b: 1-1, c: 1-1, all with 0 point diff (no sets recorded) -- a beat b head-to-head.
    const rows = computeStandings(matches, [], ["a", "b", "c"]);
    const aIndex = rows.findIndex((r) => r.registrationId === "a");
    const bIndex = rows.findIndex((r) => r.registrationId === "b");
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("ignores matches that aren't completed", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", status: "pending" }),
    ];
    const rows = computeStandings(matches, [], ["a", "b"]);
    expect(rows.every((r) => r.wins === 0 && r.losses === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- standings`
Expected: FAIL with "Cannot find module '@/lib/standings'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/standings.ts
import type { EventMatch } from "@/lib/matchAdvancement";

export interface EventMatchSet {
  match_id: string;
  set_number: number;
  team_a_points: number;
  team_b_points: number;
}

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
): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  for (const id of registrationIds) {
    rows.set(id, { registrationId: id, wins: 0, losses: 0, winPct: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 });
  }

  const setsByMatch = new Map<string, EventMatchSet[]>();
  for (const s of sets) {
    const list = setsByMatch.get(s.match_id) ?? [];
    list.push(s);
    setsByMatch.set(s.match_id, list);
  }

  const headToHead = new Map<string, string>(); // "idA|idB" -> winner id

  for (const match of matches) {
    if (match.status !== "completed" || !match.winner_registration_id) continue;
    const a = match.team_a_registration_id;
    const b = match.team_b_registration_id;
    if (!a || !b || !rows.has(a) || !rows.has(b)) continue;

    const winnerId = match.winner_registration_id;
    const loserId = winnerId === a ? b : a;
    rows.get(winnerId)!.wins += 1;
    rows.get(loserId)!.losses += 1;
    headToHead.set(`${a}|${b}`, winnerId);
    headToHead.set(`${b}|${a}`, winnerId);

    for (const s of setsByMatch.get(match.id) ?? []) {
      rows.get(a)!.pointsFor += s.team_a_points;
      rows.get(a)!.pointsAgainst += s.team_b_points;
      rows.get(b)!.pointsFor += s.team_b_points;
      rows.get(b)!.pointsAgainst += s.team_a_points;
    }
  }

  const result = Array.from(rows.values()).map((row) => {
    const played = row.wins + row.losses;
    return {
      ...row,
      winPct: played === 0 ? 0 : row.wins / played,
      pointDiff: row.pointsFor - row.pointsAgainst,
    };
  });

  result.sort((x, y) => {
    if (y.winPct !== x.winPct) return y.winPct - x.winPct;
    return y.pointDiff - x.pointDiff;
  });

  // Two-way head-to-head tie-break: only within a cluster of exactly two
  // rows sharing the same winPct and pointDiff. A wider tie (3+) is left
  // in its (stable) sorted order -- see the design spec's non-goal.
  let i = 0;
  while (i < result.length) {
    let j = i + 1;
    while (j < result.length && result[j].winPct === result[i].winPct && result[j].pointDiff === result[i].pointDiff) {
      j++;
    }
    if (j - i === 2) {
      const h2hWinner = headToHead.get(`${result[i].registrationId}|${result[i + 1].registrationId}`);
      if (h2hWinner === result[i + 1].registrationId) {
        [result[i], result[i + 1]] = [result[i + 1], result[i]];
      }
    }
    i = j;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- standings`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "Add standings computation with point-diff and head-to-head tie-breaks, test-first"
```

---

### Task 6: Pure logic — result derivation and session pairing

**Files:**
- Create: `src/lib/matchResult.ts`
- Create: `src/lib/matchResult.test.ts`
- Create: `src/lib/matchScheduling.ts`
- Create: `src/lib/matchScheduling.test.ts`

**Interfaces:**
- Produces: `SetScore`, `deriveMatchWinner` (consumed by Task 8);
  `SchedulableMatch`, `SchedulableSession`, `pairMatchesToSessions`
  (consumed by Task 9).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/matchResult.test.ts
import { describe, expect, it } from "vitest";
import { deriveMatchWinner } from "@/lib/matchResult";

describe("deriveMatchWinner", () => {
  it("picks the side that won more sets", () => {
    const winner = deriveMatchWinner(
      [
        { team_a_points: 21, team_b_points: 18 },
        { team_a_points: 19, team_b_points: 21 },
        { team_a_points: 21, team_b_points: 15 },
      ],
      "a",
      "b"
    );
    expect(winner).toBe("a");
  });

  it("returns null with no sets recorded", () => {
    expect(deriveMatchWinner([], "a", "b")).toBeNull();
  });

  it("returns null when sets are tied", () => {
    const winner = deriveMatchWinner(
      [
        { team_a_points: 21, team_b_points: 18 },
        { team_a_points: 19, team_b_points: 21 },
      ],
      "a",
      "b"
    );
    expect(winner).toBeNull();
  });
});
```

```ts
// src/lib/matchScheduling.test.ts
import { describe, expect, it } from "vitest";
import { pairMatchesToSessions } from "@/lib/matchScheduling";

describe("pairMatchesToSessions", () => {
  it("pairs matches to sessions in round/slot then start-time order", () => {
    const matches = [
      { id: "m2", round_number: 1, slot_in_round: 2 },
      { id: "m1", round_number: 1, slot_in_round: 1 },
    ];
    const sessions = [
      { id: "s2", start_time: "2026-09-08T00:00:00Z" },
      { id: "s1", start_time: "2026-09-01T00:00:00Z" },
    ];
    expect(pairMatchesToSessions(matches, sessions)).toEqual([
      { matchId: "m1", sessionId: "s1" },
      { matchId: "m2", sessionId: "s2" },
    ]);
  });

  it("leaves extra matches unassigned when there are fewer sessions", () => {
    const matches = [
      { id: "m1", round_number: 1, slot_in_round: 1 },
      { id: "m2", round_number: 1, slot_in_round: 2 },
    ];
    const sessions = [{ id: "s1", start_time: "2026-09-01T00:00:00Z" }];
    expect(pairMatchesToSessions(matches, sessions)).toEqual([{ matchId: "m1", sessionId: "s1" }]);
  });

  it("returns an empty list with no matches or no sessions", () => {
    expect(pairMatchesToSessions([], [{ id: "s1", start_time: "2026-09-01T00:00:00Z" }])).toEqual([]);
    expect(pairMatchesToSessions([{ id: "m1", round_number: 1, slot_in_round: 1 }], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- matchResult matchScheduling`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/matchResult.ts
export interface SetScore {
  team_a_points: number;
  team_b_points: number;
}

export function deriveMatchWinner(
  sets: SetScore[],
  registrationIdA: string,
  registrationIdB: string
): string | null {
  if (sets.length === 0) return null;
  let aSetsWon = 0;
  let bSetsWon = 0;
  for (const s of sets) {
    if (s.team_a_points > s.team_b_points) aSetsWon += 1;
    else if (s.team_b_points > s.team_a_points) bSetsWon += 1;
  }
  if (aSetsWon === bSetsWon) return null;
  return aSetsWon > bSetsWon ? registrationIdA : registrationIdB;
}
```

```ts
// src/lib/matchScheduling.ts
export interface SchedulableMatch {
  id: string;
  round_number: number;
  slot_in_round: number;
}

export interface SchedulableSession {
  id: string;
  start_time: string;
}

// A straight zip in order -- the Nth not-yet-scheduled match (by round,
// then slot) pairs with the Nth session (by start time). Extra matches or
// sessions beyond whichever list is shorter are simply left out; the
// caller/admin resolves those manually. No notion of "week" or court
// capacity -- see the design spec's non-goals.
export function pairMatchesToSessions(
  matches: SchedulableMatch[],
  sessions: SchedulableSession[]
): { matchId: string; sessionId: string }[] {
  const sortedMatches = [...matches].sort((a, b) =>
    a.round_number !== b.round_number ? a.round_number - b.round_number : a.slot_in_round - b.slot_in_round
  );
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  const count = Math.min(sortedMatches.length, sortedSessions.length);
  const pairs: { matchId: string; sessionId: string }[] = [];
  for (let i = 0; i < count; i++) {
    pairs.push({ matchId: sortedMatches[i].id, sessionId: sortedSessions[i].id });
  }
  return pairs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- matchResult matchScheduling`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/matchResult.ts src/lib/matchResult.test.ts src/lib/matchScheduling.ts src/lib/matchScheduling.test.ts
git commit -m "Add match result derivation and session-pairing logic, test-first"
```

---

### Task 7: Admin actions — generate and regenerate a bracket

**Files:**
- Create: `src/app/admin/eventMatchActions.ts`

**Interfaces:**
- Consumes: `generateSingleElimBracket`, `generateDoubleElimBracket`,
  `generateRoundRobinMatches`, `generatePoolPlayMatches`, `nextPowerOf2`,
  `SeedSlot` from Tasks 3-4; `EventMatch` from Task 2.
- Produces: `generateBracket(formData)`, `regenerateBracket(formData)`
  (consumed by Task 10; extended by Tasks 8-9).

- [ ] **Step 1: Write the actions**

```ts
// src/app/admin/eventMatchActions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  generateSingleElimBracket,
  generateDoubleElimBracket,
  generateRoundRobinMatches,
  generatePoolPlayMatches,
  nextPowerOf2,
  type SeedSlot,
} from "@/lib/bracketGeneration";
import type { EventMatch } from "@/lib/matchAdvancement";

function bracketPath(locationId: string, eventId: string) {
  return `/admin/locations/${locationId}/events/${eventId}/bracket`;
}

export async function generateBracket(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const format = String(formData.get("format")); // 'single_elim' | 'double_elim' | 'round_robin' | 'pool_play'
  const seeding = String(formData.get("seeding") || "registration_order"); // 'registration_order' | 'random' | 'manual'
  const byeMode = String(formData.get("bye_mode") || "auto"); // 'auto' | 'manual'

  const supabase = await createClient();

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select("id, registered_at")
    .eq("event_id", eventId)
    .eq("status", "registered")
    .order("registered_at", { ascending: true });

  const regIds = (registrations ?? []).map((r) => r.id);
  if (regIds.length < 2) {
    redirect(
      `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Need at least 2 registered teams/players to generate a bracket.")}`
    );
  }

  let orderedIds = regIds;
  if (seeding === "random") {
    orderedIds = [...regIds].sort(() => Math.random() - 0.5);
  } else if (seeding === "manual") {
    // Task 10's form renders a numeric "seed" input per registrant
    // (name="seed_for_<id>"), defaulting to registration order -- sort by
    // whatever the admin typed. Avoids needing client-side drag-and-drop
    // reordering for a plain server-rendered form.
    orderedIds = regIds
      .map((id) => ({ id, seedNumber: Number(formData.get(`seed_for_${id}`) || 0) }))
      .sort((a, b) => a.seedNumber - b.seedNumber)
      .map((r) => r.id);
  }

  let matches: EventMatch[];

  if (format === "single_elim" || format === "double_elim") {
    const bracketSize = nextPowerOf2(orderedIds.length);
    const numByes = bracketSize - orderedIds.length;

    const seeds: SeedSlot[] = orderedIds.map((id, i) => ({ registrationId: id, seed: i + 1 }));
    for (let i = orderedIds.length + 1; i <= bracketSize; i++) {
      seeds.push({ registrationId: null, seed: i });
    }

    if (byeMode === "manual" && numByes > 0) {
      const manualByeSeeds = formData.getAll("bye_seed").map((s) => Number(s));
      if (manualByeSeeds.length === numByes) {
        const currentByeSeeds = seeds.filter((s) => s.registrationId === null).map((s) => s.seed);
        for (let i = 0; i < manualByeSeeds.length; i++) {
          const target = seeds.find((s) => s.seed === manualByeSeeds[i]);
          const placeholder = seeds.find((s) => s.seed === currentByeSeeds[i]);
          if (target && placeholder && target !== placeholder) {
            const temp = target.registrationId;
            target.registrationId = placeholder.registrationId;
            placeholder.registrationId = temp;
          }
        }
      }
    }

    if (format === "double_elim" && bracketSize < 4) {
      redirect(
        `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Double elimination needs at least 3 registered teams/players.")}`
      );
    }

    matches = format === "single_elim" ? generateSingleElimBracket(seeds, eventId) : generateDoubleElimBracket(seeds, eventId);
  } else if (format === "round_robin") {
    matches = generateRoundRobinMatches(orderedIds, eventId);
  } else if (format === "pool_play") {
    const pools: Record<string, string[]> = {};
    for (const id of orderedIds) {
      const poolLabel = String(formData.get(`pool_for_${id}`) || "pool_a");
      pools[poolLabel] = pools[poolLabel] ?? [];
      pools[poolLabel].push(id);
    }
    matches = generatePoolPlayMatches(pools, eventId);
  } else {
    redirect(`${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Unknown bracket format.")}`);
  }

  const { error } = await supabase.from("event_matches").insert(matches);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(`${bracketPath(locationId, eventId)}?bracket_generated=1`);
}

export async function regenerateBracket(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { count: completedCount } = await supabase
    .from("event_matches")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "completed");

  if ((completedCount ?? 0) > 0) {
    redirect(
      `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Can't regenerate: results have already been recorded for this bracket.")}`
    );
  }

  const { error } = await supabase.from("event_matches").delete().eq("event_id", eventId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(bracketPath(locationId, eventId));
  redirect(`${bracketPath(locationId, eventId)}?bracket_reset=1`);
}
```

- [ ] **Step 2: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same tests as before

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/eventMatchActions.ts
git commit -m "Add generateBracket and regenerateBracket admin actions"
```

---

### Task 8: Admin actions — record a result and edit a match

**Files:**
- Modify: `src/app/admin/eventMatchActions.ts`

**Interfaces:**
- Consumes: `propagateAdvancement` from Task 2, `deriveMatchWinner` from
  Task 6.
- Produces: `recordMatchResult(formData)`, `editMatch(formData)` (consumed
  by Task 10).

- [ ] **Step 1: Add the imports and actions**

Add to the top of `src/app/admin/eventMatchActions.ts`:

```ts
import { propagateAdvancement } from "@/lib/matchAdvancement";
import { deriveMatchWinner } from "@/lib/matchResult";
```

Append the two actions:

```ts
// Applies a completed match's advancement one hop downstream, writing
// only the two slot columns each affected match actually needs. Returns
// the ids of any downstream matches that were already `completed` and so
// were left untouched instead of overwritten -- the caller surfaces these
// to the admin as a "review this match" banner rather than silently
// cascading further (see the design spec's "Correction cascade" decision).
async function applyAdvancement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  completedMatch: EventMatch,
  eventId: string
): Promise<string[]> {
  const { data: allMatches } = await supabase.from("event_matches").select("*").eq("event_id", eventId);
  const { updatedMatches, secondHopWarnings } = propagateAdvancement(completedMatch, (allMatches ?? []) as EventMatch[]);
  for (const m of updatedMatches) {
    await supabase
      .from("event_matches")
      .update({ team_a_registration_id: m.team_a_registration_id, team_b_registration_id: m.team_b_registration_id })
      .eq("id", m.id);
  }
  return secondHopWarnings.map((m) => m.id);
}

export async function recordMatchResult(formData: FormData) {
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

  let winnerId: string | null = null;

  if (forfeit) {
    if (!forfeitWinner) {
      redirect(`${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Pick who wins the forfeit.")}`);
    }
    winnerId = forfeitWinner;
  } else {
    const setRows: { match_id: string; set_number: number; team_a_points: number; team_b_points: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const a = formData.get(`set_${i}_a`);
      const b = formData.get(`set_${i}_b`);
      if (a === null || b === null || a === "" || b === "") continue;
      setRows.push({ match_id: matchId, set_number: i, team_a_points: Number(a), team_b_points: Number(b) });
    }
    if (setRows.length === 0) {
      redirect(
        `${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Enter at least one set's score, or mark a forfeit.")}`
      );
    }

    winnerId = deriveMatchWinner(setRows, match.team_a_registration_id, match.team_b_registration_id);
    if (!winnerId) {
      redirect(`${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Sets are tied -- can't determine a winner.")}`);
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
  redirect(
    `${bracketPath(locationId, eventId)}?result_saved=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}

export async function editMatch(formData: FormData) {
  const matchId = String(formData.get("match_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const teamA = String(formData.get("team_a_registration_id") || "") || null;
  const teamB = String(formData.get("team_b_registration_id") || "") || null;
  const winnerId = String(formData.get("winner_registration_id") || "") || null;
  const sessionId = String(formData.get("session_id") || "") || null;
  const adminNote = String(formData.get("admin_note") || "").trim() || null;

  const supabase = await createClient();
  const status: EventMatch["status"] = winnerId ? "completed" : sessionId ? "scheduled" : "pending";

  const { error } = await supabase
    .from("event_matches")
    .update({
      team_a_registration_id: teamA,
      team_b_registration_id: teamB,
      winner_registration_id: winnerId,
      session_id: sessionId,
      admin_note: adminNote,
      status,
    })
    .eq("id", matchId);
  if (error) {
    throw new Error(error.message);
  }

  let reviewNeeded: string[] = [];
  if (winnerId) {
    const { data: match } = await supabase.from("event_matches").select("*").eq("id", matchId).single();
    if (match) {
      reviewNeeded = await applyAdvancement(supabase, match as EventMatch, eventId);
    }
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(
    `${bracketPath(locationId, eventId)}?match_edited=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}
```

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/eventMatchActions.ts
git commit -m "Add recordMatchResult and editMatch admin actions"
```

---

### Task 9: Admin actions — auto-assign sessions and withdraw a registration

**Files:**
- Modify: `src/app/admin/eventMatchActions.ts`

**Interfaces:**
- Consumes: `pairMatchesToSessions` from Task 6.
- Produces: `autoAssignSessions(formData)`, `withdrawRegistration(formData)`
  (consumed by Task 10).

- [ ] **Step 1: Add the import and actions**

Add to the imports:

```ts
import { pairMatchesToSessions } from "@/lib/matchScheduling";
```

Append:

```ts
export async function autoAssignSessions(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: matches } = await supabase
    .from("event_matches")
    .select("id, round_number, slot_in_round")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .is("session_id", null);

  const { data: usedSessionRows } = await supabase
    .from("event_matches")
    .select("session_id")
    .eq("event_id", eventId)
    .not("session_id", "is", null);
  const usedSessionIds = new Set((usedSessionRows ?? []).map((r) => r.session_id));

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time")
    .eq("event_id", eventId)
    .order("start_time");
  const availableSessions = (sessions ?? []).filter((s) => !usedSessionIds.has(s.id));

  const pairs = pairMatchesToSessions(matches ?? [], availableSessions);

  for (const pair of pairs) {
    await supabase
      .from("event_matches")
      .update({ session_id: pair.sessionId, status: "scheduled" })
      .eq("id", pair.matchId);
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(`${bracketPath(locationId, eventId)}?sessions_assigned=${pairs.length}&sessions_total=${(matches ?? []).length}`);
}

export async function withdrawRegistration(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const resolution = String(formData.get("resolution") || ""); // 'forfeit' | 'substitute'
  const substituteId = String(formData.get("substitute_registration_id") || "") || null;

  const supabase = await createClient();

  await supabase.from("event_registrations").update({ status: "cancelled" }).eq("id", registrationId);

  const { data: pendingMatch } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .neq("status", "completed")
    .or(`team_a_registration_id.eq.${registrationId},team_b_registration_id.eq.${registrationId}`)
    .maybeSingle();

  let reviewNeeded: string[] = [];

  if (pendingMatch) {
    const isTeamA = pendingMatch.team_a_registration_id === registrationId;

    if (resolution === "substitute" && substituteId) {
      await supabase
        .from("event_matches")
        .update(isTeamA ? { team_a_registration_id: substituteId } : { team_b_registration_id: substituteId })
        .eq("id", pendingMatch.id);
    } else {
      const opponentId = isTeamA ? pendingMatch.team_b_registration_id : pendingMatch.team_a_registration_id;
      if (opponentId) {
        await supabase
          .from("event_matches")
          .update({
            winner_registration_id: opponentId,
            is_forfeit: true,
            status: "completed",
            admin_note: "Opponent withdrew.",
          })
          .eq("id", pendingMatch.id);

        reviewNeeded = await applyAdvancement(
          supabase,
          { ...pendingMatch, winner_registration_id: opponentId, status: "completed" } as EventMatch,
          eventId
        );
      }
    }
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(
    `${bracketPath(locationId, eventId)}?withdrawn=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}
```

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/eventMatchActions.ts
git commit -m "Add autoAssignSessions and withdrawRegistration admin actions"
```

---

### Task 10: Admin — bracket management page

**Files:**
- Create: `src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `generateBracket`, `regenerateBracket`, `recordMatchResult`,
  `editMatch`, `autoAssignSessions`, `withdrawRegistration` from Tasks
  7-9; `computeStandings` from Task 5.

- [ ] **Step 1: Add a link to the bracket page from the event management page**

In `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`, add
right after the existing `<p>` showing `EVENT_TYPE_LABELS[event.event_type]}
· {event.status}</p>`:

```tsx
      <p className="mt-2">
        <Link href={`/admin/locations/${locationId}/events/${eventId}/bracket`} className="text-sm underline">
          Manage Bracket &rarr;
        </Link>
      </p>
```

- [ ] **Step 2: Write the bracket page**

```tsx
// src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  generateBracket,
  regenerateBracket,
  recordMatchResult,
  editMatch,
  autoAssignSessions,
  withdrawRegistration,
} from "@/app/admin/eventMatchActions";
import { computeStandings } from "@/lib/standings";
import { nextPowerOf2 } from "@/lib/bracketGeneration";
import SuccessBanner from "@/components/SuccessBanner";

export default async function AdminBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    bracket_generated?: string;
    bracket_reset?: string;
    result_saved?: string;
    match_edited?: string;
    sessions_assigned?: string;
    sessions_total?: string;
    withdrawn?: string;
    generate_error?: string;
    result_error?: string;
    review_needed?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const sp = await searchParams;
  const reviewNeededIds = sp.review_needed ? sp.review_needed.split(",") : [];
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, registration_mode")
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

  const nameByRegistrationId = new Map(
    (registrations ?? []).map((r) => {
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
    .in("match_id", (matches ?? []).map((m) => m.id).length > 0 ? (matches ?? []).map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]);

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId)
    .order("start_time");

  const eliminationBracketSize = nextPowerOf2((registrations ?? []).length);
  const bracketsPresent = Array.from(new Set((matches ?? []).map((m) => m.bracket)));
  const unscheduledCount = (matches ?? []).filter((m) => m.status === "pending" && !m.session_id).length;
  const unusedSessionCount = (sessions ?? []).filter((s) => !(matches ?? []).some((m) => m.session_id === s.id)).length;
  const anyCompleted = (matches ?? []).some((m) => m.status === "completed");

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events/${eventId}`} className="text-sm underline">
        &larr; {event.title}
      </Link>
      <h1 className="mt-4 text-lg font-medium">Bracket</h1>

      {sp.bracket_generated && <SuccessBanner>Bracket generated.</SuccessBanner>}
      {sp.bracket_reset && <SuccessBanner>Bracket reset.</SuccessBanner>}
      {sp.result_saved && <SuccessBanner>Result saved.</SuccessBanner>}
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
      {(sp.generate_error || sp.result_error) && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {sp.generate_error || sp.result_error}
        </p>
      )}
      {reviewNeededIds.length > 0 && (
        <div className="mt-2 rounded bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
          <p>
            This correction fed into {reviewNeededIds.length} match{reviewNeededIds.length > 1 ? "es" : ""} that{" "}
            {reviewNeededIds.length > 1 ? "were" : "was"} already completed, so it wasn&apos;t auto-updated. Review
            and, if needed, correct it via Edit Match:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {reviewNeededIds.map((id) => {
              const m = (matches ?? []).find((match) => match.id === id);
              if (!m) return <li key={id}>Match {id}</li>;
              return (
                <li key={id}>
                  {m.bracket} round {m.round_number}: {nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                  {nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                </li>
              );
            })}
          </ul>
        </div>
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

          {bracketsPresent.map((bracket) => {
            const bracketMatches = (matches ?? []).filter((m) => m.bracket === bracket);
            const registrationIdsInBracket = Array.from(
              new Set(
                bracketMatches.flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id]).filter((id): id is string => Boolean(id))
              )
            );
            const standings =
              bracket !== "winners" && bracket !== "losers" && bracket !== "playoff"
                ? computeStandings(bracketMatches, sets ?? [], registrationIdsInBracket)
                : null;

            return (
              <div key={bracket} className="mt-8">
                <h2 className="text-lg font-medium capitalize">{bracket.replace(/_/g, " ")}</h2>

                {standings && (
                  <table className="mt-2 w-full max-w-md text-sm">
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

                <ul className="mt-3 flex flex-col gap-2">
                  {bracketMatches.map((match) => {
                    const session = (sessions ?? []).find((s) => s.id === match.session_id);
                    const sessionCourt = session ? (Array.isArray(session.court) ? session.court[0] : session.court) : null;
                    return (
                      <li key={match.id} className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800">
                        <p className="text-sm">
                          Round {match.round_number} &middot;{" "}
                          {nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                          {nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}
                          {match.winner_registration_id && (
                            <> &mdash; winner: {nameByRegistrationId.get(match.winner_registration_id)}</>
                          )}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-neutral-400">
                          {match.status}
                          {match.is_bye ? " (bye)" : ""}
                          {match.is_forfeit ? " (forfeit)" : ""}
                          {session && (
                            <>
                              {" "}
                              &middot; {session.label ? `${session.label} -- ` : ""}
                              {sessionCourt?.name}
                            </>
                          )}
                        </p>
                        {match.admin_note && <p className="text-xs italic text-gray-600 dark:text-neutral-400">{match.admin_note}</p>}

                        {match.status !== "completed" && match.team_a_registration_id && match.team_b_registration_id && (
                          <details className="mt-2">
                            <summary className="w-fit cursor-pointer text-xs underline">Enter Result</summary>
                            <form action={recordMatchResult} className="mt-2 flex max-w-sm flex-col gap-2">
                              <input type="hidden" name="match_id" value={match.id} />
                              <input type="hidden" name="event_id" value={eventId} />
                              <input type="hidden" name="location_id" value={locationId} />
                              {[1, 2, 3, 4, 5].map((n) => (
                                <div key={n} className="flex items-center gap-2 text-xs">
                                  <span className="w-10">Set {n}</span>
                                  <input name={`set_${n}_a`} type="number" min="0" className="w-16 rounded border px-2 py-1" />
                                  <span>-</span>
                                  <input name={`set_${n}_b`} type="number" min="0" className="w-16 rounded border px-2 py-1" />
                                </div>
                              ))}
                              <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" name="forfeit" /> Forfeit / walkover instead
                              </label>
                              <select name="forfeit_winner" className="rounded border px-2 py-1 text-xs dark:bg-neutral-900">
                                <option value="">Forfeit winner (if checked above)</option>
                                <option value={match.team_a_registration_id}>
                                  {nameByRegistrationId.get(match.team_a_registration_id)}
                                </option>
                                <option value={match.team_b_registration_id}>
                                  {nameByRegistrationId.get(match.team_b_registration_id)}
                                </option>
                              </select>
                              <button type="submit" className="w-fit rounded bg-black px-3 py-1.5 text-xs text-white">
                                Save Result
                              </button>
                            </form>
                          </details>
                        )}

                        <details className="mt-2">
                          <summary className="w-fit cursor-pointer text-xs underline">Edit Match</summary>
                          <form action={editMatch} className="mt-2 flex max-w-sm flex-col gap-2">
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
                                  <option value={match.team_a_registration_id}>{nameByRegistrationId.get(match.team_a_registration_id)}</option>
                                )}
                                {match.team_b_registration_id && (
                                  <option value={match.team_b_registration_id}>{nameByRegistrationId.get(match.team_b_registration_id)}</option>
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
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {!anyCompleted && (
            <form action={regenerateBracket} className="mt-6">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
                Regenerate Bracket
              </button>
            </form>
          )}
        </>
      )}

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

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx"
git commit -m "Add admin bracket management page"
```

---

### Task 11: Player — display name for individual registration

**Files:**
- Modify: `src/app/actions/events.ts`
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- No new exports; extends `registerForEvent`'s existing signature.

- [ ] **Step 1: Capture and store display_name on individual registration**

In `src/app/actions/events.ts`, add near the top of `registerForEvent`,
alongside the existing `teamName`/`teammateNames` reads:

```ts
  const displayName = String(formData.get("display_name") || "").trim();
```

Change the final insert to include it (only meaningful for individual
registrations -- `teamId` is set for the team path, which uses
`event_teams.name` instead):

```ts
  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
    display_name: teamId ? null : displayName || null,
  });
```

Add a guard right after the `event.status` check, so an individual
registration always carries a name once brackets exist for it:

```ts
  if (event.registration_mode === "individual" && !displayName) {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Enter a display name.")}`);
  }
```

- [ ] **Step 2: Add the form field on the event detail page**

In `src/app/events/[eventId]/page.tsx`, the plain (non-team) registration
form currently reads:

```tsx
                <form action={registerForEvent}>
                  <input type="hidden" name="event_id" value={event.id} />
                  <button
```

Change it to collect a display name first:

```tsx
                <form action={registerForEvent} className="flex flex-col gap-3">
                  <input type="hidden" name="event_id" value={event.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Display name (shown in results)
                    <input name="display_name" required className="rounded border px-3 py-2" />
                  </label>
                  <button
```

(The closing `</form>` and button markup are unchanged -- only the opening
tag and the new label are added.)

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts "src/app/events/[eventId]/page.tsx"
git commit -m "Collect a display name for individual event registration"
```

---

### Task 12: Player — bracket and standings on the event detail page

**Files:**
- Create: `src/components/MatchCard.tsx`
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `computeStandings` from Task 5.

- [ ] **Step 1: Write the match card client component**

```tsx
// src/components/MatchCard.tsx
"use client";

import { useState } from "react";

interface MatchCardProps {
  roundLabel: string;
  sideAName: string;
  sideBName: string;
  winnerName: string | null;
  sets: { set_number: number; team_a_points: number; team_b_points: number }[];
  isForfeit: boolean;
  adminNote: string | null;
  sessionSummary: string | null;
}

export default function MatchCard({
  roundLabel,
  sideAName,
  sideBName,
  winnerName,
  sets,
  isForfeit,
  adminNote,
  sessionSummary,
}: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      className="w-56 shrink-0 rounded border border-gray-300 px-3 py-2 text-left text-sm dark:border-neutral-800"
    >
      <p className="text-xs text-gray-600 dark:text-neutral-400">{roundLabel}</p>
      <p className={winnerName === sideAName ? "font-medium" : ""}>{sideAName}</p>
      <p className={winnerName === sideBName ? "font-medium" : ""}>{sideBName}</p>
      {isForfeit && <p className="text-xs text-gray-600 dark:text-neutral-400">Forfeit</p>}
      {sessionSummary && <p className="text-xs text-gray-600 dark:text-neutral-400">{sessionSummary}</p>}
      {expanded && (
        <div className="mt-2 border-t border-gray-200 pt-2 text-xs dark:border-neutral-700">
          {sets.length === 0 && <p>No sets recorded.</p>}
          {sets.map((s) => (
            <p key={s.set_number}>
              Set {s.set_number}: {s.team_a_points}-{s.team_b_points}
            </p>
          ))}
          {adminNote && <p className="mt-1 italic">{adminNote}</p>}
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Add the bracket/standings section to the event detail page**

In `src/app/events/[eventId]/page.tsx`, add the imports:

```tsx
import { computeStandings } from "@/lib/standings";
import MatchCard from "@/components/MatchCard";
```

After the existing `sessions` query/sort (`const sessions = [...event.event_sessions]...`),
add the matches/sets/registrations queries:

```tsx
  const { data: matches } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .order("bracket")
    .order("round_number")
    .order("slot_in_round");

  const matchIds = (matches ?? []).map((m) => m.id);
  const { data: matchSets } =
    matchIds.length > 0
      ? await supabase.from("event_match_sets").select("*").in("match_id", matchIds)
      : { data: [] };

  const { data: allRegistrations } = await supabase
    .from("event_registrations")
    .select("id, display_name, team:event_teams(name)")
    .eq("event_id", eventId);
  const nameByRegistrationId = new Map(
    (allRegistrations ?? []).map((r) => {
      const team = Array.isArray(r.team) ? r.team[0] : r.team;
      return [r.id, team?.name ?? r.display_name ?? "Player"];
    })
  );

  const { data: matchSessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId);

  const bracketsPresent = Array.from(new Set((matches ?? []).map((m) => m.bracket)));
```

Add a new section right after the existing "Sessions" `<ul>` closes:

```tsx
      {bracketsPresent.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Bracket</h2>
          {bracketsPresent.map((bracket) => {
            const bracketMatches = (matches ?? []).filter((m) => m.bracket === bracket);
            const isEliminationTree = bracket === "winners" || bracket === "losers" || bracket === "playoff";
            const registrationIdsInBracket = Array.from(
              new Set(
                bracketMatches
                  .flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id])
                  .filter((id): id is string => Boolean(id))
              )
            );
            const standings = !isEliminationTree
              ? computeStandings(bracketMatches, matchSets ?? [], registrationIdsInBracket)
              : null;
            const rounds = Array.from(new Set(bracketMatches.map((m) => m.round_number))).sort((a, b) => a - b);

            return (
              <div key={bracket} className="mt-4">
                <h3 className="text-sm font-medium capitalize">{bracket.replace(/_/g, " ")}</h3>

                {isEliminationTree && (
                  <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
                    {rounds.map((roundNumber) => (
                      <div key={roundNumber} className="flex shrink-0 flex-col gap-2">
                        <p className="sticky top-0 bg-white text-xs font-medium dark:bg-neutral-950">
                          Round {roundNumber}
                        </p>
                        {bracketMatches
                          .filter((m) => m.round_number === roundNumber)
                          .map((m) => {
                            const session = (matchSessions ?? []).find((s) => s.id === m.session_id);
                            const court = session ? (Array.isArray(session.court) ? session.court[0] : session.court) : null;
                            return (
                              <MatchCard
                                key={m.id}
                                roundLabel={`Round ${roundNumber}`}
                                sideAName={nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"}
                                sideBName={nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                                winnerName={m.winner_registration_id ? nameByRegistrationId.get(m.winner_registration_id) ?? null : null}
                                sets={(matchSets ?? []).filter((s) => s.match_id === m.id)}
                                isForfeit={m.is_forfeit}
                                adminNote={m.admin_note}
                                sessionSummary={session ? `${session.label ? session.label + " -- " : ""}${court?.name ?? ""}` : null}
                              />
                            );
                          })}
                      </div>
                    ))}
                  </div>
                )}

                {standings && (
                  <table className="mt-2 w-full max-w-md text-sm">
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
              </div>
            );
          })}
        </>
      )}
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchCard.tsx "src/app/events/[eventId]/page.tsx"
git commit -m "Show the bracket tree and standings on the player event detail page"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers
  schema-level checks).
- **Single elimination with byes:** publish a tournament event, register 6
  players/teams, generate a single-elim bracket (auto bye mode), confirm 2
  bye matches auto-complete and their winners already show in round 2, play
  it through to a champion.
- **Double elimination:** register 4 teams for a tournament, generate a
  double-elim bracket, play the winners bracket, confirm losers correctly
  drop into the losers bracket, play it through to the grand final, confirm
  the losers-bracket finalist can beat the winners-bracket champion and
  become the overall winner via that single grand-final match.
- **Round robin:** register 5 players for an individual event, generate a
  round robin, confirm every pair appears exactly once and no round repeats
  a player, play a few matches with per-set scores, confirm standings order
  by win % then point differential.
- **Pool play:** register 6 teams, generate pool play across 2 manually
  assigned pools, confirm independent per-pool standings; manually generate
  a follow-up single-elim playoff bracket seeded from the pool standings.
- **Forfeit:** enter a forfeit result on a pending match, confirm the
  opponent advances with no sets recorded.
- **Manual override and cascade:** edit an already-completed match that fed
  a downstream match; confirm the one-hop auto-propagation; complete the
  downstream match; edit the original match again and confirm a
  second-hop-affected match is left alone (not silently overwritten) --
  verify this by inspecting that downstream match's data directly, since
  this plan's admin UI doesn't render a dedicated warning banner for it.
- **Withdrawal:** withdraw a registration with a pending match, exercise
  both the forfeit-opponent path and the substitute-registration path.
- **League shape:** create a league event, add 4 weekly `event_sessions`,
  register 4 teams, generate a round robin, run "Auto-assign to sessions,"
  confirm matches land on the right weeks in chronological order; manually
  reassign one match to a different session via Edit Match. Confirm the
  player-facing match cards show each match's session date/court. Then,
  once the season's matches are complete, generate a follow-up single-elim
  playoff bracket for the same event and assign it to a further batch of
  sessions the same way; confirm regular-season and playoff matches
  coexist without interference (independent standings, independent bracket
  labels).
- Confirm the player-facing bracket renders correctly on a narrow (mobile)
  viewport -- horizontal scroll, tap-to-expand match cards.
- Confirm an individual registrant's `display_name` is required at
  registration and renders correctly in the bracket.
- Confirm a staff-role account (not owner/admin) can generate brackets and
  record results, matching the existing capability split.
