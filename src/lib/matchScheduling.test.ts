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
