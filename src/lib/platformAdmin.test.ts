import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIsPlatformAdmin } from "./platformAdmin";

function mockSupabase(row: { is_platform_admin: boolean } | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("getIsPlatformAdmin", () => {
  it("returns false when there is no signed-in user", async () => {
    const result = await getIsPlatformAdmin(mockSupabase(null), undefined);
    expect(result).toBe(false);
  });

  it("returns true when the user's row has is_platform_admin set", async () => {
    const result = await getIsPlatformAdmin(mockSupabase({ is_platform_admin: true }), "user-1");
    expect(result).toBe(true);
  });

  it("returns false when the user's row has is_platform_admin unset", async () => {
    const result = await getIsPlatformAdmin(mockSupabase({ is_platform_admin: false }), "user-1");
    expect(result).toBe(false);
  });
});
