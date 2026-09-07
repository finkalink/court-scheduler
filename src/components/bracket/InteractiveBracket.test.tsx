import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import InteractiveBracket from "./InteractiveBracket";
import { recordMatchResult } from "@/app/admin/eventMatchActions";
import type { EventMatch } from "@/lib/matchAdvancement";

let capturedOnMatchClick: ((match: { roundIndex: number; order: number }) => void) | null = null;

vi.mock("bracketry", () => ({
  createBracket: vi.fn((_data, _el, options) => {
    capturedOnMatchClick = options.onMatchClick;
    return { applyMatchesUpdates: vi.fn(), replaceData: vi.fn(), uninstall: vi.fn() };
  }),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/app/admin/eventMatchActions", () => ({
  recordMatchResult: vi.fn(async () => ({ ok: true, reviewNeeded: [] })),
}));

function buildMatch(overrides: Partial<EventMatch>): EventMatch {
  return {
    id: "m1",
    event_id: "e1",
    bracket: "winners",
    round_number: 1,
    slot_in_round: 1,
    team_a_registration_id: "regA",
    team_b_registration_id: "regB",
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

const nameByRegistrationId = new Map([
  ["regA", "Team A"],
  ["regB", "Team B"],
  ["regC", "Team C"],
  ["regD", "Team D"],
]);

const defaultProps = {
  eventId: "e1",
  locationId: "l1",
  nameByRegistrationId,
  bestOfSets: 3,
  pointsPerSet: 21,
  winBy: 2,
  interactive: true,
};

beforeEach(() => {
  capturedOnMatchClick = null;
  mockRefresh.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InteractiveBracket", () => {
  it("opens the result sheet when an active-round match is tapped", () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[round1]} sets={[]} />);

    act(() => {
      capturedOnMatchClick?.({ roundIndex: 0, order: 0 });
    });

    expect(screen.getByText("Team A vs Team B")).toBeInTheDocument();
  });

  it("does not open the sheet for a match in a locked round", () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    const round2 = buildMatch({
      id: "r2",
      round_number: 2,
      slot_in_round: 1,
      team_a_registration_id: "regC",
      team_b_registration_id: "regD",
      status: "pending",
    });
    render(<InteractiveBracket {...defaultProps} matches={[round1, round2]} sets={[]} />);

    act(() => {
      capturedOnMatchClick?.({ roundIndex: 1, order: 0 });
    });

    expect(screen.queryByText("Team C vs Team D")).not.toBeInTheDocument();
  });

  it("closes the sheet and refreshes the router after a successful save", async () => {
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[round1]} sets={[]} />);

    act(() => {
      capturedOnMatchClick?.({ roundIndex: 0, order: 0 });
    });
    fireEvent.click(screen.getByText("Save Result"));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByText("Team A vs Team B")).not.toBeInTheDocument();
  });

  it("always opens the sheet for round-robin matches, regardless of round", () => {
    const match = buildMatch({ id: "r1", bracket: "round_robin", round_number: 3, status: "pending" });
    render(<InteractiveBracket {...defaultProps} matches={[match]} sets={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Team A/ }));

    expect(screen.getByText("Team A vs Team B")).toBeInTheDocument();
  });

  it("shows the review-needed banner, listing the affected match, when a correction returns one", async () => {
    vi.mocked(recordMatchResult).mockResolvedValueOnce({ ok: true, reviewNeeded: ["r2"] });
    const round1 = buildMatch({ id: "r1", round_number: 1, slot_in_round: 1, status: "pending" });
    const round2 = buildMatch({
      id: "r2",
      round_number: 2,
      slot_in_round: 1,
      team_a_registration_id: "regC",
      team_b_registration_id: "regD",
      status: "completed",
      winner_registration_id: "regC",
    });
    render(<InteractiveBracket {...defaultProps} matches={[round1, round2]} sets={[]} />);

    act(() => {
      capturedOnMatchClick?.({ roundIndex: 0, order: 0 });
    });
    fireEvent.click(screen.getByText("Save Result"));

    await waitFor(() =>
      expect(screen.getByText(/fed into 1 match/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/winners round 2: Team C vs Team D/i)).toBeInTheDocument();
  });
});
