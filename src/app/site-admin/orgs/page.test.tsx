import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SiteAdminOrgsPage from "./page";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

type OrgRow = {
  id: string;
  name: string;
  is_active: boolean;
  org_members: { user_id: string }[];
  locations: { id: string; courts: { id: string }[] }[];
};

function buildOrg(overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    id: "org-1",
    name: "Ace Volleyball Club",
    is_active: true,
    org_members: [{ user_id: "user-1" }],
    locations: [{ id: "loc-1", courts: [{ id: "court-1" }] }],
    ...overrides,
  };
}

function mockClient({ isPlatformAdmin, orgs }: { isPlatformAdmin: boolean; orgs: OrgRow[] }) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { is_platform_admin: isPlatformAdmin } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          order: () => Promise.resolve({ data: orgs }),
        }),
      };
    },
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("SiteAdminOrgsPage", () => {
  it("shows an access-denied message for a non-platform-admin", async () => {
    mockClient({ isPlatformAdmin: false, orgs: [] });
    const ui = await SiteAdminOrgsPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("You don't have access to site admin.")).toBeInTheDocument();
  });

  it("lists organizations with member, location, and court counts for a platform admin", async () => {
    mockClient({ isPlatformAdmin: true, orgs: [buildOrg()] });
    const ui = await SiteAdminOrgsPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Ace Volleyball Club")).toBeInTheDocument();
    expect(screen.getByText("1 member · 1 location · 1 court")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows an Inactive badge and Activate button for a deactivated org", async () => {
    mockClient({ isPlatformAdmin: true, orgs: [buildOrg({ is_active: false })] });
    const ui = await SiteAdminOrgsPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("shows a success banner after creating an organization", async () => {
    mockClient({ isPlatformAdmin: true, orgs: [buildOrg()] });
    const ui = await SiteAdminOrgsPage({ searchParams: Promise.resolve({ club_created: "1" }) });
    render(ui);
    expect(screen.getByText("Organization created.")).toBeInTheDocument();
  });
});
