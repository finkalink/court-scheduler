import { describe, expect, it } from "vitest";
import { computeStandings, type EventMatchSet } from "@/lib/standings";
import type { EventMatch } from "@/lib/matchAdvancement";

function match(overrides: Partial<EventMatch> & { id: string }): EventMatch {
  return {
    event_id: "e1",
    bracket: "round_robin",
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

describe("computeStandings", () => {
  it("ranks by win percentage", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "a", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "a", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
      match({ id: "m3", team_a_registration_id: "b", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
    ];
    const rows = computeStandings(matches, [], ["a", "b", "c"]);
    expect(rows.map((r) => r.registrationId)).toEqual(["c", "a", "b"]);
    expect(rows[0].wins).toBe(2);
    expect(rows[0].losses).toBe(0);
  });

  it("breaks a win-percentage tie by point differential", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "a", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "c", team_b_registration_id: "b", winner_registration_id: "c", status: "completed" }),
    ];
    const sets: EventMatchSet[] = [
      { match_id: "m1", set_number: 1, team_a_points: 21, team_b_points: 5 },
      { match_id: "m2", set_number: 1, team_a_points: 21, team_b_points: 19 },
    ];
    const rows = computeStandings(matches, sets, ["a", "b", "c"]);
    expect(rows[0].registrationId).toBe("a"); // same 1-0 record as c, bigger point diff
    expect(rows[0].pointDiff).toBe(16);
  });

  it("breaks an exact two-way tie by head-to-head result", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", winner_registration_id: "b", status: "completed" }),
      match({ id: "m2", team_a_registration_id: "a", team_b_registration_id: "c", winner_registration_id: "a", status: "completed" }),
      match({ id: "m3", team_a_registration_id: "b", team_b_registration_id: "c", winner_registration_id: "c", status: "completed" }),
    ];
    // a: 1-1, b: 1-1, c: 1-1, all with 0 point diff (no sets recorded) -- a beat b head-to-head.
    const rows = computeStandings(matches, [], ["a", "b", "c"]);
    const aIndex = rows.findIndex((r) => r.registrationId === "a");
    const bIndex = rows.findIndex((r) => r.registrationId === "b");
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("ignores matches that aren't completed", () => {
    const matches: EventMatch[] = [
      match({ id: "m1", team_a_registration_id: "a", team_b_registration_id: "b", status: "pending" }),
    ];
    const rows = computeStandings(matches, [], ["a", "b"]);
    expect(rows.every((r) => r.wins === 0 && r.losses === 0)).toBe(true);
  });
});
