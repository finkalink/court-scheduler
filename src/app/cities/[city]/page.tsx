import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clubsInCity } from "@/lib/cityGrouping";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: cityParam } = await params;
  const city = decodeURIComponent(cityParam);
  const supabase = await createClient();

  const { data: locations } = await supabase
    .from("locations")
    .select("id, city, organization:organizations(id, name), courts!inner(id, is_active)")
    .eq("city", city)
    .eq("courts.is_active", true);

  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .map((l) => {
      const org = Array.isArray(l.organization) ? l.organization[0] : l.organization;
      return { id: l.id, city: l.city, orgId: org?.id ?? "", orgName: org?.name ?? "" };
    });

  const clubs = clubsInCity(uniqueLocations, city);

  if (clubs.length === 0) {
    notFound();
  }

  const { data: allEvents } = await supabase
    .from("events")
    .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
    .neq("status", "draft");

  const eventsInCity = (allEvents ?? [])
    .map((e) => {
      const eventLocation = Array.isArray(e.location) ? e.location[0] : e.location;
      return {
        id: e.id,
        title: e.title,
        eventType: e.event_type,
        city: eventLocation?.city ?? null,
        sessions: e.event_sessions,
      };
    })
    .filter((e) => e.city === city);

  const upcomingEvents = sortBySoonestSession(eventsInCity, new Date());

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{city}</h1>

      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Events in {city}</h2>
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

      <h2 className="mt-8 text-sm font-medium">Clubs</h2>

      <ul className="mt-2 flex flex-col gap-3">
        {clubs.map((club) => (
          <li key={club.orgId}>
            <Link
              href={`/clubs/${club.orgId}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{club.orgName}</p>
              <p className="text-sm text-gray-600">
                {club.locationCount} location{club.locationCount === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
