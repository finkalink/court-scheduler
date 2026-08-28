import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { createLocation } from "@/app/admin/actions";
import SuccessBanner from "@/components/SuccessBanner";
import LocationFormFields from "@/components/LocationFormFields";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ location_added?: string }>;
}) {
  const { location_added } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership) {
    return null; // admin/layout.tsx already handles the no-membership state.
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, courts(id)")
    .eq("org_id", membership.orgId)
    .order("name");

  return (
    <div>
      <h2 className="text-lg font-medium">{membership.orgName} — Locations</h2>

      {location_added && <SuccessBanner>Location added.</SuccessBanner>}

      {(!locations || locations.length === 0) && (
        <p className="mt-1 text-sm text-gray-600">No locations yet. Add one below.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(locations ?? []).map((location) => (
          <li key={location.id}>
            <Link
              href={`/admin/locations/${location.id}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{location.name}</p>
              <p className="text-sm text-gray-600">
                {location.address ? `${location.address} · ` : ""}
                {location.courts?.length ?? 0} court{location.courts?.length === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-sm font-medium">Add a location</h3>
      <form action={createLocation} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="org_id" value={membership.orgId} />
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" required className="rounded border px-3 py-2" />
        </label>
        <LocationFormFields
          defaultAddress=""
          defaultPostalCode={null}
          defaultLatitude={null}
          defaultLongitude={null}
          defaultFormattedAddress={null}
          defaultTimezone="America/Los_Angeles"
        />
        <button type="submit" className="mt-1 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Add location
        </button>
      </form>
    </div>
  );
}
