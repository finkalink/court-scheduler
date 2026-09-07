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

export interface MatchScoringConfig {
  pointsPerSet: number;
  winBy: number;
}

// No hard cap -- a set that runs past pointsPerSet (deuce) is valid as long
// as the winning margin is still met.
export function isValidSetScore(teamAPoints: number, teamBPoints: number, config: MatchScoringConfig): boolean {
  if (teamAPoints === teamBPoints) return false;
  const winnerPoints = Math.max(teamAPoints, teamBPoints);
  const margin = Math.abs(teamAPoints - teamBPoints);
  return winnerPoints >= config.pointsPerSet && margin >= config.winBy;
}
