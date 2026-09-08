// src/components/LandingPage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "./LandingPage";

// Same mocking style as AllCitiesContent.test.tsx: createClient() is
// mocked, and `from()` here branches on the table name because
// LandingPage queries both "events" and "locations" via Promise.all.
const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

type EventRow = {
  id: string;
  title: string;
  event_type: string;
  location: { city: string | null };
  event_sessions: { start_time: string }[];
};

type LocationRow = {
  id: string;
  city: string | null;
  organization: { id: string; name: string };
  courts: { id: string; is_active: boolean }[];
};

function buildEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "event-1",
    title: "Spring Tournament",
    event_type: "tournament",
    location: { city: "City of Westminster" },
    event_sessions: [{ start_time: "2099-01-01T00:00:00.000Z" }],
    ...overrides,
  };
}

function buildLocation(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: "loc-1",
    city: "City of Westminster",
    organization: { id: "org-1", name: "Org 1" },
    courts: [{ id: "court-1", is_active: true }],
    ...overrides,
  };
}

function mockData(events: EventRow[], locations: LocationRow[]) {
  mockCreateClient.mockResolvedValue({
    from: (table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            neq: () => ({
              neq: () => Promise.resolve({ data: events }),
            }),
          }),
        };
      }
      if (table === "locations") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: locations }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("LandingPage", () => {
  it("renders the hero headline and search form", async () => {
    mockData([], []);

    const ui = await LandingPage();
    render(ui);

    expect(screen.getByText("court.")).toBeInTheDocument();
    const form = screen.getByPlaceholderText("City of Westminster").closest("form");
    expect(form).toHaveAttribute("action", "/cities");
    expect(form).toHaveAttribute("method", "get");
  });

  it("renders upcoming events and featured clubs when data exists", async () => {
    mockData([buildEvent()], [buildLocation()]);

    const ui = await LandingPage();
    render(ui);

    expect(screen.getByText("Upcoming events")).toBeInTheDocument();
    expect(screen.getByText("Featured clubs")).toBeInTheDocument();
    expect(screen.getByText("Spring Tournament")).toBeInTheDocument();
    expect(screen.getByText("Org 1")).toBeInTheDocument();
  });

  it("omits the events and clubs sections entirely when there is no data", async () => {
    mockData([], []);

    const ui = await LandingPage();
    render(ui);

    expect(screen.queryByText("Upcoming events")).not.toBeInTheDocument();
    expect(screen.queryByText("Featured clubs")).not.toBeInTheDocument();
  });
});
