import { describe, expect, it } from "vitest";
import { propagateAdvancement, type EventMatch } from "@/lib/matchAdvancement";

function baseMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: null,
    team_b_registration_id: null,
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

describe("propagateAdvancement", () => {
  it("fills a downstream match's slot with the winner", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const downstream = baseMatch({
      id: "m2",
      round_number: 2,
      team_a_advances_from_match_id: "m1",
      advancement_type_a: "winner",
    });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, downstream]);

    expect(updatedMatches).toHaveLength(1);
    expect(updatedMatches[0].id).toBe("m2");
    expect(updatedMatches[0].team_a_registration_id).toBe("regA");
    expect(secondHopWarnings).toHaveLength(0);
  });

  it("fills a losers-bracket slot with the loser", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const losersMatch = baseMatch({
      id: "lm1",
      bracket: "losers",
      team_b_advances_from_match_id: "m1",
      advancement_type_b: "loser",
    });

    const { updatedMatches } = propagateAdvancement(completed, [completed, losersMatch]);

    expect(updatedMatches[0].team_b_registration_id).toBe("regB");
  });

  it("flags an already-completed downstream match instead of overwriting it", () => {
    const completed = baseMatch({
      id: "m1",
      team_a_registration_id: "regA",
      team_b_registration_id: "regB",
      winner_registration_id: "regA",
      status: "completed",
    });
    const downstream = baseMatch({
      id: "m2",
      team_a_advances_from_match_id: "m1",
      advancement_type_a: "winner",
      team_a_registration_id: "regA",
      team_b_registration_id: "regC",
      winner_registration_id: "regC",
      status: "completed",
    });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, downstream]);

    expect(updatedMatches).toHaveLength(0);
    expect(secondHopWarnings).toHaveLength(1);
    expect(secondHopWarnings[0].id).toBe("m2");
  });

  it("does nothing when no match references the completed one", () => {
    const completed = baseMatch({ id: "m1", winner_registration_id: "regA", status: "completed" });
    const unrelated = baseMatch({ id: "m2" });

    const { updatedMatches, secondHopWarnings } = propagateAdvancement(completed, [completed, unrelated]);

    expect(updatedMatches).toHaveLength(0);
    expect(secondHopWarnings).toHaveLength(0);
  });
});
