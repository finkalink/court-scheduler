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
