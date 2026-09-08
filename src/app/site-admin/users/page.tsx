import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import {
  toggleUserActive,
  togglePlatformAdmin,
  updateAnyOrgMemberRole,
} from "@/app/site-admin/actions";

export default async function SiteAdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const rawQ = (await searchParams).q;
  const q = Array.isArray(rawQ) ? rawQ[0] : rawQ;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = await getIsPlatformAdmin(supabase, user?.id);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
        You don&apos;t have access to site admin.
      </div>
    );
  }

  const trimmedQ = q?.trim();
  const usersQuery =
    trimmedQ && trimmedQ.length > 0
      ? supabase
          .from("users")
          .select("id, email, is_platform_admin, is_active")
          .ilike("email", `%${trimmedQ}%`)
          .order("created_at", { ascending: false })
          .limit(50)
      : supabase
          .from("users")
          .select("id, email, is_platform_admin, is_active")
          .order("created_at", { ascending: false })
          .limit(50);
  const { data: users } = await usersQuery;

  const usersWithMemberships = await Promise.all(
    (users ?? []).map(async (u) => {
      const { data: memberships } = await supabase
        .from("org_members")
        .select("org_id, role, organization:organizations(name)")
        .eq("user_id", u.id);
      return {
        ...u,
        memberships: (memberships ?? []).map((m) => {
          const org = Array.isArray(m.organization) ? m.organization[0] : m.organization;
          return { orgId: m.org_id, role: m.role, orgName: org?.name ?? "" };
        }),
      };
    })
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Users</h1>

      <form action="/site-admin/users" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by email"
          aria-label="Search by email"
          className="w-full rounded border border-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-accent-fg">
          Search
        </button>
      </form>

      {usersWithMemberships.length === 0 && (
        <p className="mt-6 text-sm text-fg-muted">
          {q ? `No users match "${q}".` : "No users yet."}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {usersWithMemberships.map((u) => (
          <li key={u.id} className="rounded border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{u.email}</span>
              <div className="flex items-center gap-3">
                <form action={togglePlatformAdmin}>
                  <input type="hidden" name="user_id" value={u.id} />
                  <input type="hidden" name="next_value" value={String(!u.is_platform_admin)} />
                  <button type="submit" className="text-xs underline">
                    {u.is_platform_admin ? "Remove site admin" : "Make site admin"}
                  </button>
                </form>
                <form action={toggleUserActive}>
                  <input type="hidden" name="user_id" value={u.id} />
                  <input type="hidden" name="next_active" value={String(!u.is_active)} />
                  <button type="submit" className="text-xs text-link underline">
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </div>

            {u.memberships.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {u.memberships.map((m) => (
                  <li key={m.orgId} className="flex items-center gap-2 text-sm text-fg-muted">
                    <span>{m.orgName}</span>
                    {m.role === "owner" ? (
                      <span>Owner</span>
                    ) : (
                      <form action={updateAnyOrgMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="org_id" value={m.orgId} />
                        <input type="hidden" name="user_id" value={u.id} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          className="rounded border border-border px-2 py-1 text-sm"
                        >
                          <option value="admin">Admin</option>
                          <option value="staff">Staff</option>
                        </select>
                        <button type="submit" className="text-xs underline">
                          Save
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
