import { describe, expect, it } from "vitest";
import { computeActiveRounds, isMatchTappable } from "@/lib/activeRounds";
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

describe("computeActiveRounds", () => {
  it("returns round 1 when round 1 has an incomplete match", () => {
    const matches = [buildMatch({ id: "m1", round_number: 1, status: "pending" })];
    expect(computeActiveRounds(matches)).toEqual({ winners: 1 });
  });

  it("returns round 2 once every round-1 match is completed", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 1, slot_in_round: 2, status: "completed" }),
      buildMatch({ id: "m3", round_number: 2, status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2 });
  });

  it("keeps round 2 locked while a sibling round-1 match is still pending, even if a round-2 match already has both teams known", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 1, slot_in_round: 2, status: "pending" }),
      // round 2's own two sources (from a different part of the bracket)
      // already resolved, so it has real teams -- but round 1 as a whole
      // isn't done yet.
      buildMatch({ id: "m3", round_number: 2, team_a_registration_id: "c", team_b_registration_id: "d", status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 1 });
  });

  it("returns the last round when the whole bracket is complete", () => {
    const matches = [
      buildMatch({ id: "m1", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", round_number: 2, status: "completed" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2 });
  });

  it("tracks each bracket group independently", () => {
    const matches = [
      buildMatch({ id: "m1", bracket: "winners", round_number: 1, status: "completed" }),
      buildMatch({ id: "m2", bracket: "winners", round_number: 2, status: "pending" }),
      buildMatch({ id: "m3", bracket: "losers", round_number: 1, status: "pending" }),
    ];
    expect(computeActiveRounds(matches)).toEqual({ winners: 2, losers: 1 });
  });
});

describe("isMatchTappable", () => {
  it("is tappable when it's the active round and both teams are known", () => {
    const match = buildMatch({ round_number: 1, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(true);
  });

  it("is not tappable when the round is past the active round", () => {
    const match = buildMatch({ round_number: 2, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(false);
  });

  it("is not tappable when a team slot is still unknown, even in the active round", () => {
    const match = buildMatch({ round_number: 1, team_b_registration_id: null, status: "pending" });
    expect(isMatchTappable(match, 1)).toBe(false);
  });

  it("is always tappable once completed, regardless of round", () => {
    const match = buildMatch({ round_number: 5, status: "completed" });
    expect(isMatchTappable(match, 1)).toBe(true);
  });
});
