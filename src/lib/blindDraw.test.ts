import { describe, expect, it } from "vitest";
import { computeTeamSizes, drawBalancedTeams, SKILL_LEVELS } from "./blindDraw";

describe("computeTeamSizes", () => {
  it("splits evenly when the count divides exactly", () => {
    expect(computeTeamSizes(12, 6)).toEqual([6, 6]);
  });

  it("never exceeds the target size, spreading the remainder across leading teams", () => {
    expect(computeTeamSizes(13, 6)).toEqual([5, 4, 4]);
  });

  it("forms exactly one team when the count is at or under the target", () => {
    expect(computeTeamSizes(4, 6)).toEqual([4]);
    expect(computeTeamSizes(6, 6)).toEqual([6]);
  });

  it("forms one team per registrant when the target size is 1", () => {
    expect(computeTeamSizes(3, 1)).toEqual([1, 1, 1]);
  });

  it("returns an empty list for zero registrants", () => {
    expect(computeTeamSizes(0, 6)).toEqual([]);
  });
});

describe("drawBalancedTeams", () => {
  it("assigns every registrant to exactly one team, respecting computed sizes", () => {
    const registrants = Array.from({ length: 13 }, (_, i) => ({
      id: `r${i}`,
      displayName: `Player ${i}`,
      skillLevel: SKILL_LEVELS[i % SKILL_LEVELS.length],
    }));

    const teams = drawBalancedTeams(registrants, 6);

    expect(teams.map((t) => t.memberIds.length)).toEqual([5, 4, 4]);
    const allAssigned = teams.flatMap((t) => t.memberIds);
    expect(allAssigned.sort()).toEqual(registrants.map((r) => r.id).sort());
  });

  it("balances total skill rank across teams rather than seeding by tier", () => {
    // 4 "Open" (rank 5) and 4 "Recreational" (rank 0), target size 2 -> 4 teams of 2.
    // A tier-seeded split would produce 2 all-Open teams and 2 all-Recreational teams;
    // balanced drafting should pair a high with a low in every team instead.
    const registrants = [
      { id: "a", displayName: "A", skillLevel: "Open" },
      { id: "b", displayName: "B", skillLevel: "Open" },
      { id: "c", displayName: "C", skillLevel: "Open" },
      { id: "d", displayName: "D", skillLevel: "Open" },
      { id: "e", displayName: "E", skillLevel: "Recreational" },
      { id: "f", displayName: "F", skillLevel: "Recreational" },
      { id: "g", displayName: "G", skillLevel: "Recreational" },
      { id: "h", displayName: "H", skillLevel: "Recreational" },
    ];

    const teams = drawBalancedTeams(registrants, 2);

    expect(teams).toHaveLength(4);
    for (const team of teams) {
      const members = team.memberIds.map((id) => registrants.find((r) => r.id === id)!);
      const ranks = members.map((m) => (SKILL_LEVELS as readonly string[]).indexOf(m.skillLevel));
      expect(Math.max(...ranks) - Math.min(...ranks)).toBeGreaterThan(0);
    }
  });

  it("degrades to an even split when every rating is equal", () => {
    const registrants = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`,
      displayName: `Player ${i}`,
      skillLevel: "BB",
    }));

    const teams = drawBalancedTeams(registrants, 3);

    expect(teams.map((t) => t.memberIds.length)).toEqual([3, 3, 3]);
  });

  it("returns an empty list for zero registrants", () => {
    expect(drawBalancedTeams([], 6)).toEqual([]);
  });

  it("is deterministic for the same input order", () => {
    const registrants = Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      displayName: `Player ${i}`,
      skillLevel: SKILL_LEVELS[i % SKILL_LEVELS.length],
    }));

    const first = drawBalancedTeams(registrants, 3);
    const second = drawBalancedTeams(registrants, 3);
    expect(first).toEqual(second);
  });
});
