import { describe, expect, it } from "vitest";
import {
  nextPowerOf2,
  seedOrder,
  generateSingleElimBracket,
  generateDoubleElimBracket,
  generateRoundRobinMatches,
  generatePoolPlayMatches,
  type SeedSlot,
} from "@/lib/bracketGeneration";
import { propagateAdvancement, type EventMatch } from "@/lib/matchAdvancement";

describe("nextPowerOf2", () => {
  it("rounds up to the next power of 2", () => {
    expect(nextPowerOf2(1)).toBe(1);
    expect(nextPowerOf2(2)).toBe(2);
    expect(nextPowerOf2(3)).toBe(4);
    expect(nextPowerOf2(6)).toBe(8);
    expect(nextPowerOf2(8)).toBe(8);
    expect(nextPowerOf2(9)).toBe(16);
  });
});

describe("seedOrder", () => {
  it("produces the standard bracket seeding order", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

function seeds(ids: (string | null)[]): SeedSlot[] {
  return ids.map((registrationId, i) => ({ registrationId, seed: i + 1 }));
}

describe("generateSingleElimBracket", () => {
  it("generates one round-1 match for a 2-team bracket", () => {
    const matches = generateSingleElimBracket(seeds(["a", "b"]), "e1");
    expect(matches).toHaveLength(1);
    expect(matches[0].round_number).toBe(1);
    expect(matches[0].team_a_registration_id).toBe("a");
    expect(matches[0].team_b_registration_id).toBe("b");
    expect(matches[0].status).toBe("pending");
  });

  it("generates 3 matches across 2 rounds for a 4-team bracket, round 2 unfilled", () => {
    const matches = generateSingleElimBracket(seeds(["a", "b", "c", "d"]), "e1");
    expect(matches).toHaveLength(3);
    const round1 = matches.filter((m) => m.round_number === 1);
    const round2 = matches.filter((m) => m.round_number === 2);
    expect(round1).toHaveLength(2);
    expect(round2).toHaveLength(1);
    expect(round2[0].team_a_registration_id).toBeNull();
    expect(round2[0].team_a_advances_from_match_id).toBe(round1[0].id);
    expect(round2[0].team_b_advances_from_match_id).toBe(round1[1].id);
  });

  it("auto-completes a bye match and propagates the winner into round 2", () => {
    // 3 real teams padded to a 4-slot bracket; seed 4 is a bye.
    const matches = generateSingleElimBracket(seeds(["a", "b", "c", null]), "e1");
    const round1 = matches.filter((m) => m.round_number === 1);
    const byeMatch = round1.find((m) => m.is_bye);
    expect(byeMatch).toBeDefined();
    expect(byeMatch!.status).toBe("completed");
    expect(byeMatch!.winner_registration_id).not.toBeNull();

    const round2 = matches.find((m) => m.round_number === 2)!;
    const feedsFromBye =
      round2.team_a_advances_from_match_id === byeMatch!.id
        ? round2.team_a_registration_id
        : round2.team_b_registration_id;
    expect(feedsFromBye).toBe(byeMatch!.winner_registration_id);
  });
});

describe("generateDoubleElimBracket", () => {
  it("throws for a bracket smaller than 4", () => {
    expect(() => generateDoubleElimBracket(seeds(["a", "b"]), "e1")).toThrow();
  });

  it("generates the full winners + losers + grand-final structure for 4 teams", () => {
    const matches = generateDoubleElimBracket(seeds(["a", "b", "c", "d"]), "e1");
    const winners = matches.filter((m) => m.bracket === "winners");
    const losers = matches.filter((m) => m.bracket === "losers");
    const playoff = matches.filter((m) => m.bracket === "playoff");

    expect(winners).toHaveLength(3); // 2 round-1 + 1 final
    expect(losers).toHaveLength(2); // N - 2
    expect(playoff).toHaveLength(1); // grand final

    const grandFinal = playoff[0];
    const winnersFinal = winners.find((m) => m.round_number === 2)!;
    const losersFinal = losers.reduce((a, b) => (a.round_number > b.round_number ? a : b));
    expect(grandFinal.team_a_advances_from_match_id).toBe(winnersFinal.id);
    expect(grandFinal.team_b_advances_from_match_id).toBe(losersFinal.id);
    expect(grandFinal.advancement_type_a).toBe("winner");
    expect(grandFinal.advancement_type_b).toBe("winner"); // winner OF the losers bracket
  });

  it("generates 6 losers-bracket matches for an 8-team bracket (N - 2)", () => {
    const matches = generateDoubleElimBracket(
      seeds(["a", "b", "c", "d", "e", "f", "g", "h"]),
      "e1"
    );
    const losers = matches.filter((m) => m.bracket === "losers");
    expect(losers).toHaveLength(6);
  });

  it("drops the LOSER (not the winner) of a winners-round-1 match into the losers bracket", () => {
    // Regression test: pairSelf's very first call (pairing WR1's match ids
    // directly, before any LR matches exist) must use 'loser' advancement,
    // not 'winner' -- confirmed by actually completing a WR1 match and
    // propagating, rather than just inspecting the generated links.
    const matches = generateDoubleElimBracket(seeds(["a", "b", "c", "d"]), "e1");
    const wr1NonByeMatch = matches.find(
      (m) => m.bracket === "winners" && m.round_number === 1 && !m.is_bye
    )!;
    const completed: EventMatch = {
      ...wr1NonByeMatch,
      winner_registration_id: wr1NonByeMatch.team_a_registration_id,
      status: "completed",
    };
    const { updatedMatches } = propagateAdvancement(completed, matches);

    const lr1Match = matches.find((m) => m.bracket === "losers" && m.round_number === 1)!;
    const updatedLr1 = updatedMatches.find((m) => m.id === lr1Match.id)!;
    const filledSlot =
      updatedLr1.team_a_advances_from_match_id === wr1NonByeMatch.id
        ? updatedLr1.team_a_registration_id
        : updatedLr1.team_b_registration_id;

    expect(filledSlot).toBe(wr1NonByeMatch.team_b_registration_id); // the loser, not team_a (the winner)
  });
});

describe("generateRoundRobinMatches", () => {
  it("generates every pair exactly once for 4 teams", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c", "d"], "e1");
    expect(matches).toHaveLength(6); // C(4,2)

    const pairs = new Set(
      matches.map((m) => [m.team_a_registration_id, m.team_b_registration_id].sort().join("|"))
    );
    expect(pairs.size).toBe(6);
  });

  it("groups matches into rounds where no team repeats", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c", "d"], "e1");
    const byRound = new Map<number, string[]>();
    for (const m of matches) {
      const list = byRound.get(m.round_number) ?? [];
      list.push(m.team_a_registration_id!, m.team_b_registration_id!);
      byRound.set(m.round_number, list);
    }
    for (const ids of byRound.values()) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("handles an odd number of teams with a bye week (no crash, correct match count)", () => {
    const matches = generateRoundRobinMatches(["a", "b", "c"], "e1");
    expect(matches).toHaveLength(3); // C(3,2)
  });

  it("labels matches with a custom bracket name", () => {
    const matches = generateRoundRobinMatches(["a", "b"], "e1", "pool_a");
    expect(matches[0].bracket).toBe("pool_a");
  });
});

describe("generatePoolPlayMatches", () => {
  it("generates independent round robins per pool", () => {
    const matches = generatePoolPlayMatches({ pool_a: ["a", "b"], pool_b: ["c", "d", "e"] }, "e1");
    const poolA = matches.filter((m) => m.bracket === "pool_a");
    const poolB = matches.filter((m) => m.bracket === "pool_b");
    expect(poolA).toHaveLength(1);
    expect(poolB).toHaveLength(3); // C(3,2)
    for (const m of poolA) {
      expect(["a", "b"]).toContain(m.team_a_registration_id);
      expect(["a", "b"]).toContain(m.team_b_registration_id);
    }
  });
});
