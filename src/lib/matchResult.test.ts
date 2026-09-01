import { describe, expect, it } from "vitest";
import { deriveMatchWinner } from "@/lib/matchResult";

describe("deriveMatchWinner", () => {
  it("picks the side that won more sets", () => {
    const winner = deriveMatchWinner(
      [
        { team_a_points: 21, team_b_points: 18 },
        { team_a_points: 19, team_b_points: 21 },
        { team_a_points: 21, team_b_points: 15 },
      ],
      "a",
      "b"
    );
    expect(winner).toBe("a");
  });

  it("returns null with no sets recorded", () => {
    expect(deriveMatchWinner([], "a", "b")).toBeNull();
  });

  it("returns null when sets are tied", () => {
    const winner = deriveMatchWinner(
      [
        { team_a_points: 21, team_b_points: 18 },
        { team_a_points: 19, team_b_points: 21 },
      ],
      "a",
      "b"
    );
    expect(winner).toBeNull();
  });
});
