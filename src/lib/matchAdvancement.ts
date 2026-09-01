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
