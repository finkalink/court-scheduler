import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";
import { groupLocationsByCity } from "@/lib/cityGrouping";

export default async function Home() {
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: locations } = await supabase
    .from("locations")
    .select(
      "id, name, address, city, latitude, longitude, organization:organizations(id, name), courts!inner(id, is_active)"
    )
    .eq("courts.is_active", true);

  // Dedupe locations (the courts!inner join returns one row per matching court)
  // and flatten the organization relation into orgId/orgName for the grouping
  // helper, which is generic over any shape carrying those two fields.
  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .map((l) => {
      const org = Array.isArray(l.organization) ? l.organization[0] : l.organization;
      return {
        id: l.id,
        name: l.name,
        address: l.address,
        city: l.city,
        latitude: l.latitude,
        longitude: l.longitude,
        orgId: org?.id ?? "",
        orgName: org?.name ?? "",
      };
    });

  const { cities, otherLocations } = groupLocationsByCity(uniqueLocations);
  const sortedOtherLocations = [...otherLocations].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

      {cities.length === 0 && sortedOtherLocations.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No locations available yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {cities.map((cityGroup) => (
          <li key={cityGroup.city}>
            <Link
              href={`/cities/${encodeURIComponent(cityGroup.city)}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{cityGroup.city}</p>
              <p className="text-sm text-gray-600">
                {cityGroup.clubCount} club{cityGroup.clubCount === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {sortedOtherLocations.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium">Other locations</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {sortedOtherLocations.map((location) => {
              const mapsUrl = buildMapsUrl({
                latitude: location.latitude ?? null,
                longitude: location.longitude ?? null,
                address: location.address ?? null,
                userAgent,
              });
              return (
                <li
                  key={location.id}
                  className="rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <Link href={`/locations/${location.id}`} className="block font-medium">
                    {location.name}
                  </Link>
                  <Link
                    href={`/clubs/${location.orgId}`}
                    className="text-sm text-gray-600 underline decoration-dotted"
                  >
                    {location.orgName}
                  </Link>
                  {location.address && (
                    <a
                      href={mapsUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-sm text-gray-600 underline decoration-dotted"
                    >
                      {location.address}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
