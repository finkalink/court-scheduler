import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { toggleOrgActive } from "@/app/site-admin/actions";
import { buttonClass } from "@/lib/buttonStyles";
import SuccessBanner from "@/components/SuccessBanner";

export const metadata: Metadata = { title: "Organizations" };

export default async function SiteAdminOrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ club_created?: string }>;
}) {
  const { club_created } = await searchParams;
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

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, is_active, org_members(user_id), locations(id, courts(id))")
    .order("name");

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Organizations</h1>

      {club_created && <SuccessBanner>Organization created.</SuccessBanner>}

      <a href="/site-admin/orgs/new" className={`mt-2 inline-block ${buttonClass("primary")}`}>
        Add organization
      </a>

      {(!orgs || orgs.length === 0) && (
        <p className="mt-6 text-sm text-fg-muted">No organizations yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {(orgs ?? []).map((org) => {
          const memberCount = org.org_members?.length ?? 0;
          const locationCount = org.locations?.length ?? 0;
          const courtCount = (org.locations ?? []).reduce(
            (sum, location) => sum + (location.courts?.length ?? 0),
            0
          );

          return (
            <li
              key={org.id}
              className="flex items-center justify-between gap-3 rounded border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {org.name}{" "}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      org.is_active ? "bg-status text-status-fg" : "bg-active text-fg-muted"
                    }`}
                  >
                    {org.is_active ? "Active" : "Inactive"}
                  </span>
                </p>
                <p className="text-sm text-fg-muted">
                  {memberCount} member{memberCount === 1 ? "" : "s"} · {locationCount} location
                  {locationCount === 1 ? "" : "s"} · {courtCount} court{courtCount === 1 ? "" : "s"}
                </p>
              </div>
              <form action={toggleOrgActive}>
                <input type="hidden" name="org_id" value={org.id} />
                <input type="hidden" name="next_active" value={String(!org.is_active)} />
                <button type="submit" className="text-sm text-link underline">
                  {org.is_active ? "Deactivate" : "Activate"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
