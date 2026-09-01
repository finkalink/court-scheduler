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
