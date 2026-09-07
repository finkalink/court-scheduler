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
