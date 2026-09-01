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
// Edit Match, same as any other manual correction.
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

const BYE_PLACEHOLDER = "__bye__";

// Standard round-robin "circle method": one item is fixed, the rest
// rotate one position each round; each round pairs position i with
// position (n-1-i). Produces n-1 rounds where no item repeats within a
// round.
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
