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
