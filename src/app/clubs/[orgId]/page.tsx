import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";

export default async function ClubPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();

  if (!org) {
    notFound();
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, latitude, longitude, courts!inner(id, is_active)")
    .eq("org_id", orgId)
    .eq("courts.is_active", true);

  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (uniqueLocations.length === 0) {
    notFound();
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/cities" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{org.name}</h1>

      <ul className="mt-6 flex flex-col gap-3">
        {uniqueLocations.map((location) => {
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
              <Link href={`/locations/${location.id}`} className="block">
                <p className="font-medium">{location.name}</p>
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
