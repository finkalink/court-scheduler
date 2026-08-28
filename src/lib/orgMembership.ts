import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/orgRoles";

export interface CurrentMembership {
  orgId: string;
  orgName: string | null;
  role: OrgRole;
}

// First org membership for a user. If a user belongs to more than one org,
// this returns whichever one Postgres happens to return first -- same
// pre-existing, deliberate limitation the admin section already has.
export async function getCurrentMembership(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<CurrentMembership | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from("org_members")
    .select("org_id, role, organization:organizations(name)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const org = Array.isArray(data.organization) ? data.organization[0] : data.organization;

  return {
    orgId: data.org_id,
    orgName: org?.name ?? null,
    role: data.role as OrgRole,
  };
}

// Role for a specific org -- for pages that already know which org they're
// showing (e.g. via a location's org_id), so a user in more than one org
// still gets the right answer for the org actually being viewed.
export async function getRoleForOrg(
  supabase: SupabaseClient,
  userId: string | undefined,
  orgId: string
): Promise<OrgRole | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  return (data?.role as OrgRole) ?? null;
}
