import { describe, it, expect, vi } from "vitest";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import SiteAdminPage from "./page";

describe("SiteAdminPage", () => {
  it("redirects to /site-admin/orgs", () => {
    SiteAdminPage();
    expect(mockRedirect).toHaveBeenCalledWith("/site-admin/orgs");
  });
});
