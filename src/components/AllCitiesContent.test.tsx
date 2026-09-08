// src/components/AllCitiesContent.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AllCitiesContent from "./AllCitiesContent";

// No existing test mocks @/lib/supabase/server or next/headers anywhere in
// this codebase yet, so this mock is scoped tightly to what
// AllCitiesContent actually calls: a single
// `.from("locations").select(...).eq(...)` chain, plus `headers()` for the
// maps-link user-agent sniff.
const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map<string, string>(),
}));

type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  organization: { id: string; name: string };
  courts: { id: string; is_active: boolean }[];
};

function buildLocation(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: "loc-1",
    name: "Location 1",
    address: null,
    city: "City of Westminster",
    latitude: null,
    longitude: null,
    organization: { id: "org-1", name: "Org 1" },
    courts: [{ id: "court-1", is_active: true }],
    ...overrides,
  };
}

function mockLocations(locations: LocationRow[]) {
  mockCreateClient.mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: locations }),
      }),
    }),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("AllCitiesContent", () => {
  it("hides a city that does not match filterQuery", async () => {
    mockLocations([
      buildLocation({
        id: "loc-1",
        city: "City of Westminster",
        organization: { id: "org-1", name: "Org 1" },
      }),
      buildLocation({
        id: "loc-2",
        city: "Camden",
        organization: { id: "org-2", name: "Org 2" },
      }),
    ]);

    const ui = await AllCitiesContent({ filterQuery: "west" });
    render(ui);

    expect(screen.getByText("City of Westminster")).toBeInTheDocument();
    expect(screen.queryByText("Camden")).not.toBeInTheDocument();
  });

  it("shows every city when no filterQuery is provided (existing call sites keep working)", async () => {
    mockLocations([
      buildLocation({
        id: "loc-1",
        city: "City of Westminster",
        organization: { id: "org-1", name: "Org 1" },
      }),
      buildLocation({
        id: "loc-2",
        city: "Camden",
        organization: { id: "org-2", name: "Org 2" },
      }),
    ]);

    const ui = await AllCitiesContent();
    render(ui);

    expect(screen.getByText("City of Westminster")).toBeInTheDocument();
    expect(screen.getByText("Camden")).toBeInTheDocument();
  });

  it("shows a search-specific empty state when filterQuery matches no cities", async () => {
    mockLocations([
      buildLocation({
        id: "loc-1",
        city: "City of Westminster",
        organization: { id: "org-1", name: "Org 1" },
      }),
    ]);

    const ui = await AllCitiesContent({ filterQuery: "nonexistent-city" });
    render(ui);

    expect(screen.getByText('No cities match "nonexistent-city".')).toBeInTheDocument();
    expect(screen.queryByText("No locations available yet.")).not.toBeInTheDocument();
  });
});
