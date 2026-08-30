import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isOwnerOrAdmin } from "@/lib/orgRoles";
import { addOrgMember, updateOrgMemberRole, removeOrgMember } from "@/app/admin/actions";
import SuccessBanner from "@/components/SuccessBanner";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    member_added?: string;
    role_updated?: string;
    member_removed?: string;
    add_error?: string;
    role_error?: string;
  }>;
}) {
  const { member_added, role_updated, member_removed, add_error, role_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership || !isOwnerOrAdmin(membership.role)) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-gray-600">
        You don&apos;t have access to manage this club&apos;s team.
      </div>
    );
  }

  const { data: memberRows } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", membership.orgId)
    .order("role");

  const { data: userRows } = await supabase.rpc("list_org_member_emails", {
    target_org_id: membership.orgId,
  });

  const emailById = new Map(
    (userRows ?? []).map((u: { user_id: string; email: string }) => [u.user_id, u.email])
  );

  return (
    <div>
      <Link href="/admin" className="text-sm underline">
        &larr; {membership.orgName}
      </Link>

      <h1 className="mt-4 text-lg font-medium">Team — {membership.orgName}</h1>

      {member_added && <SuccessBanner>Admin added.</SuccessBanner>}
      {role_updated && <SuccessBanner>Role updated.</SuccessBanner>}
      {member_removed && <SuccessBanner>Access removed.</SuccessBanner>}
      {add_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {add_error}
        </p>
      )}
      {role_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {role_error}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(memberRows ?? []).map((member) => (
          <li
            key={member.user_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-300 px-4 py-3"
          >
            <span className="text-sm">{emailById.get(member.user_id) ?? member.user_id}</span>

            {member.role === "owner" ? (
              <span className="text-sm text-gray-600">Owner</span>
            ) : (
              <form action={updateOrgMemberRole} className="flex items-center gap-2">
                <input type="hidden" name="org_id" value={membership.orgId} />
                <input type="hidden" name="user_id" value={member.user_id} />
                <select name="role" defaultValue={member.role} className="rounded border px-2 py-1 text-sm">
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
                <button type="submit" className="text-xs underline">
                  Save
                </button>
              </form>
            )}

            <form action={removeOrgMember}>
              <input type="hidden" name="org_id" value={membership.orgId} />
              <input type="hidden" name="user_id" value={member.user_id} />
              <button type="submit" className="text-xs text-red-700 underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-sm font-medium">Add an admin</h3>
      <form action={addOrgMember} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="org_id" value={membership.orgId} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" name="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <select name="role" defaultValue="staff" className="rounded border px-3 py-2">
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        <button type="submit" className="mt-1 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Add
        </button>
      </form>
    </div>
  );
}
