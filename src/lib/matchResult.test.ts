import { describe, expect, it } from "vitest";
import { deriveMatchWinner, isValidSetScore } from "@/lib/matchResult";

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

describe("isValidSetScore", () => {
  const config = { pointsPerSet: 21, winBy: 2 };

  it("accepts a clean win at the target score with margin to spare", () => {
    expect(isValidSetScore(21, 15, config)).toBe(true);
  });

  it("rejects a winning score below the target", () => {
    expect(isValidSetScore(20, 18, config)).toBe(false);
  });

  it("rejects a win by less than the required margin", () => {
    expect(isValidSetScore(21, 20, config)).toBe(false);
  });

  it("accepts a deuce set that runs past the target with the required margin", () => {
    expect(isValidSetScore(25, 23, config)).toBe(true);
  });

  it("rejects a tied score", () => {
    expect(isValidSetScore(21, 21, config)).toBe(false);
  });

  it("checks the margin regardless of which side has more points", () => {
    expect(isValidSetScore(15, 21, config)).toBe(true);
    expect(isValidSetScore(18, 20, config)).toBe(false);
  });
});
