import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SiteAdminUsersPage from "./page";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

type UserRow = {
  id: string;
  email: string;
  is_platform_admin: boolean;
  is_active: boolean;
};

function buildUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-2",
    email: "player@example.com",
    is_platform_admin: false,
    is_active: true,
    ...overrides,
  };
}

interface Chainable {
  ilike: () => Chainable;
  order: () => Chainable;
  limit: () => Promise<{ data: unknown }>;
}

function chainable(resolveValue: { data: unknown }): Chainable {
  const obj: Chainable = {
    ilike: () => obj,
    order: () => obj,
    limit: () => Promise.resolve(resolveValue),
  };
  return obj;
}

function mockClient({
  isPlatformAdmin,
  users,
  memberships = [],
}: {
  isPlatformAdmin: boolean;
  users: UserRow[];
  memberships?: { org_id: string; role: string; organization: { name: string } }[];
}) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "org_members") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: memberships }),
          }),
        };
      }
      return {
        select: (cols: string) => {
          if (cols === "is_platform_admin") {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_platform_admin: isPlatformAdmin } }),
              }),
            };
          }
          return chainable({ data: users });
        },
      };
    },
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("SiteAdminUsersPage", () => {
  it("shows an access-denied message for a non-platform-admin", async () => {
    mockClient({ isPlatformAdmin: false, users: [] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("You don't have access to site admin.")).toBeInTheDocument();
  });

  it("lists users with site-admin and active toggles for a platform admin", async () => {
    mockClient({ isPlatformAdmin: true, users: [buildUser()] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("player@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make site admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows a search-specific empty state when q matches no users", async () => {
    mockClient({ isPlatformAdmin: true, users: [] });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({ q: "nobody" }) });
    render(ui);
    expect(screen.getByText('No users match "nobody".')).toBeInTheDocument();
  });

  it("hides the site-admin toggle for the signed-in admin's own row, but keeps the deactivate toggle", async () => {
    mockClient({
      isPlatformAdmin: true,
      users: [buildUser({ id: "user-1", email: "self@example.com" })],
    });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("self@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make site admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove site admin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("renders a role-edit form for a non-owner org membership", async () => {
    mockClient({
      isPlatformAdmin: true,
      users: [buildUser()],
      memberships: [
        { org_id: "org-1", role: "staff", organization: { name: "Ace Volleyball Club" } },
      ],
    });
    const ui = await SiteAdminUsersPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Ace Volleyball Club")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("staff");
  });
});
