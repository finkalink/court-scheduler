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
