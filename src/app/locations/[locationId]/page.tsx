import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, latitude, longitude, organization:organizations(name)")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const org = Array.isArray(location.organization)
    ? location.organization[0]
    : location.organization;
  const mapsUrl = buildMapsUrl({
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    address: location.address ?? null,
    userAgent,
  });

  const { data: courts } = await supabase
    .from("courts")
    .select("id, name, surface_type")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/" className="text-sm underline">
        &larr; All locations
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{location.name}</h1>
      <p className="text-sm text-gray-600">{org?.name}</p>
      {location.address && (
        <a
          href={mapsUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-gray-600 underline decoration-dotted"
        >
          {location.address}
        </a>
      )}

      {(!courts || courts.length === 0) && (
        <p className="mt-6 text-sm text-gray-600">No courts available at this location yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {(courts ?? []).map((court) => (
          <li key={court.id}>
            <Link
              href={`/locations/${locationId}/courts/${court.id}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50"
            >
              <p className="font-medium">{court.name}</p>
              {court.surface_type && (
                <p className="text-sm text-gray-600">{court.surface_type}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
