import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, organization:organizations(name), courts!inner(id, is_active)")
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
      <h1 className="text-xl font-semibold sm:text-2xl">Find a court</h1>

      {uniqueLocations.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No locations available yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {uniqueLocations.map((location) => {
          const org = Array.isArray(location.organization)
            ? location.organization[0]
            : location.organization;
          return (
            <li key={location.id}>
              <Link
                href={`/locations/${location.id}`}
                className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50"
              >
                <p className="font-medium">{location.name}</p>
                <p className="text-sm text-gray-600">
                  {org?.name}
                  {location.address ? ` · ${location.address}` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
