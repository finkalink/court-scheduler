import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clubsInCity } from "@/lib/cityGrouping";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import EventTypeBadge from "@/components/EventTypeBadge";

export default async function CityContent({ city }: { city: string }) {
  const supabase = await createClient();

  const [{ data: locations }, { data: allEvents }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, city, organization:organizations(id, name), courts!inner(id, is_active)")
      .eq("city", city)
      .eq("courts.is_active", true),
    supabase
      .from("events")
      .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
      .neq("status", "draft")
      .neq("status", "cancelled"),
  ]);

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
    <>
      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Events in {city}</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-border bg-card px-4 py-3 hover:bg-active"
                >
                  <p className="font-medium">{event.title}</p>
                  <div className="mt-1">
                    <EventTypeBadge eventType={event.eventType} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium">Clubs</h2>

      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((club) => (
          <li key={club.orgId}>
            <Link
              href={`/clubs/${club.orgId}`}
              className="block rounded border border-border bg-card px-4 py-3 hover:bg-active"
            >
              <p className="font-medium">{club.orgName}</p>
              <p className="text-sm text-fg-muted">
                {club.locationCount} location{club.locationCount === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
