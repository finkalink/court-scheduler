import { describe, expect, it } from "vitest";
import { toBracketryData } from "@/lib/bracketryData";
import type { EventMatch } from "@/lib/matchAdvancement";

function buildMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: "a",
    team_b_registration_id: "b",
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

const names = new Map([
  ["a", "Team A"],
  ["b", "Team B"],
]);

describe("toBracketryData", () => {
  it("converts 1-indexed round/slot to 0-indexed roundIndex/order", () => {
    const data = toBracketryData([buildMatch({ round_number: 2, slot_in_round: 3 })], [], names);
    expect(data.matches[0].roundIndex).toBe(1);
    expect(data.matches[0].order).toBe(2);
  });

  it("builds one round entry per distinct round_number present", () => {
    const data = toBracketryData(
      [buildMatch({ id: "m1", round_number: 1 }), buildMatch({ id: "m2", round_number: 2 })],
      [],
      names
    );
    expect(data.rounds).toHaveLength(2);
  });

  it("registers both sides as contestants with the right title", () => {
    const data = toBracketryData([buildMatch({})], [], names);
    expect(data.contestants["a"]).toEqual({ players: [{ title: "Team A" }] });
    expect(data.contestants["b"]).toEqual({ players: [{ title: "Team B" }] });
  });

  it("leaves a side empty (no contestantId) when its registration id is null -- a bye or a not-yet-decided future round", () => {
    const data = toBracketryData([buildMatch({ team_b_registration_id: null })], [], names);
    expect(data.matches[0].sides[1]).toEqual({});
    expect(Object.keys(data.contestants)).toEqual(["a"]);
  });

  it("attaches set scores and per-side isWinner from event_match_sets", () => {
    const data = toBracketryData(
      [buildMatch({ id: "m1", winner_registration_id: "a" })],
      [
        { match_id: "m1", set_number: 1, team_a_points: 21, team_b_points: 15 },
        { match_id: "m1", set_number: 2, team_a_points: 21, team_b_points: 18 },
      ],
      names
    );
    expect(data.matches[0].sides[0].scores).toEqual([
      { mainScore: 21, isWinner: true },
      { mainScore: 21, isWinner: true },
    ]);
    expect(data.matches[0].sides[1].scores).toEqual([
      { mainScore: 15, isWinner: false },
      { mainScore: 18, isWinner: false },
    ]);
    expect(data.matches[0].sides[0].isWinner).toBe(true);
    expect(data.matches[0].sides[1].isWinner).toBe(false);
  });

  it("omits scores entirely for a match with no recorded sets", () => {
    const data = toBracketryData([buildMatch({})], [], names);
    expect(data.matches[0].sides[0].scores).toBeUndefined();
  });
});
