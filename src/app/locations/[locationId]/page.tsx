import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

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
    .select("id, name, address, latitude, longitude, organization:organizations(id, name)")
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

  const { data: locationEvents } = await supabase
    .from("events")
    .select("id, title, event_type, event_sessions(start_time)")
    .eq("location_id", locationId)
    .neq("status", "draft")
    .neq("status", "cancelled");

  const upcomingEvents = sortBySoonestSession(
    (locationEvents ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      sessions: e.event_sessions,
    })),
    new Date()
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href={`/clubs/${org?.id ?? ""}`} className="text-sm underline">
        &larr; {org?.name ?? "Club"}
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

      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Upcoming Events</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {upcomingEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium">Courts</h2>

      {(!courts || courts.length === 0) && (
        <p className="mt-2 text-sm text-gray-600">No courts available at this location yet.</p>
      )}

      <ul className="mt-2 flex flex-col gap-3">
        {(courts ?? []).map((court) => (
          <li key={court.id}>
            <Link
              href={`/locations/${locationId}/courts/${court.id}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
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
