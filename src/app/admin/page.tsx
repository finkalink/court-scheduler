import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isOwnerOrAdmin } from "@/lib/orgRoles";
import { createLocation, updateOrganization } from "@/app/admin/actions";
import SuccessBanner from "@/components/SuccessBanner";
import LocationFormFields from "@/components/LocationFormFields";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Club Admin" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ location_added?: string; org_updated?: string; org_error?: string }>;
}) {
  const { location_added, org_updated, org_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership) {
    return null; // admin/layout.tsx already handles the no-membership state.
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("venmo_handle")
    .eq("id", membership.orgId)
    .single();

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, courts(id)")
    .eq("org_id", membership.orgId)
    .order("name");

  return (
    <div>
      <h1 className="text-lg font-medium">{membership.orgName} — Locations</h1>

      {isOwnerOrAdmin(membership.role) && (
        <Link href="/admin/team" className="mt-2 block w-fit text-sm underline">
          Team &rarr;
        </Link>
      )}

      {isOwnerOrAdmin(membership.role) && (
        <details className="mt-4">
          <summary className="w-fit cursor-pointer text-sm underline">Edit club settings</summary>
          <form action={updateOrganization} className="mt-2 flex max-w-sm flex-col gap-3">
            <input type="hidden" name="org_id" value={membership.orgId} />
            <label className="flex flex-col gap-1 text-sm">
              Venmo handle (for paid events)
              <input
                name="venmo_handle"
                defaultValue={org?.venmo_handle ?? ""}
                placeholder="your-venmo-handle"
                className="rounded border border-border px-3 py-2"
              />
            </label>
            <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
              Save
            </button>
          </form>
        </details>
      )}

      {location_added && <SuccessBanner>Location added.</SuccessBanner>}
      {org_updated && <SuccessBanner>Club settings saved.</SuccessBanner>}
      {org_error && (
        <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
          {org_error}
        </p>
      )}

      {(!locations || locations.length === 0) && (
        <p className="mt-1 text-sm text-fg-muted">No locations yet. Add one below.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(locations ?? []).map((location) => (
          <li key={location.id}>
            <Link
              href={`/admin/locations/${location.id}`}
              className="block rounded border border-border px-4 py-3 hover:bg-active"
            >
              <p className="font-medium">{location.name}</p>
              <p className="text-sm text-fg-muted">
                {location.address ? `${location.address} · ` : ""}
                {location.courts?.length ?? 0} court{location.courts?.length === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {isOwnerOrAdmin(membership.role) && (
        <>
          <h3 className="mt-8 text-sm font-medium">Add a location</h3>
          <form action={createLocation} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="org_id" value={membership.orgId} />
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required className="rounded border border-border px-3 py-2" />
            </label>
            <LocationFormFields
              defaultAddress=""
              defaultPostalCode={null}
              defaultCity={null}
              defaultLatitude={null}
              defaultLongitude={null}
              defaultFormattedAddress={null}
              defaultTimezone="America/Los_Angeles"
            />
            <button type="submit" className={`mt-1 w-fit ${buttonClass("primary")}`}>
              Add location
            </button>
          </form>
        </>
      )}
    </div>
  );
}
