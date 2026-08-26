import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, organization:organizations(name)")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const org = Array.isArray(location.organization)
    ? location.organization[0]
    : location.organization;

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
      <p className="text-sm text-gray-600">
        {org?.name}
        {location.address ? ` · ${location.address}` : ""}
      </p>

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
