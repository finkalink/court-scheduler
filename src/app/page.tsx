import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";

export default async function Home() {
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: locations } = await supabase
    .from("locations")
    .select(
      "id, name, address, latitude, longitude, organization:organizations(name), courts!inner(id, is_active)"
    )
    .eq("courts.is_active", true);

  // Dedupe locations (the courts!inner join returns one row per matching court).
  const seen = new Set<string>();
  const uniqueLocations = (locations ?? []).filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

      {uniqueLocations.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No locations available yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {uniqueLocations.map((location) => {
          const org = Array.isArray(location.organization)
            ? location.organization[0]
            : location.organization;
          const mapsUrl = buildMapsUrl({
            latitude: location.latitude ?? null,
            longitude: location.longitude ?? null,
            address: location.address ?? null,
            userAgent,
          });
          return (
            <li key={location.id} className="rounded border border-gray-300 px-4 py-3 hover:bg-gray-50">
              <Link href={`/locations/${location.id}`} className="block">
                <p className="font-medium">{location.name}</p>
                <p className="text-sm text-gray-600">{org?.name}</p>
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
    </div>
  );
}
