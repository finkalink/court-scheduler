import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupEventsByCity } from "@/lib/eventGrouping";
import { formatEventDateRange } from "@/lib/dateFormat";
import EventTypeBadge from "@/components/EventTypeBadge";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_type, location:locations(city, timezone), event_sessions(start_time)")
    .neq("status", "draft")
    .neq("status", "cancelled");

  const eventsForGrouping = (events ?? []).map((e) => {
    const location = Array.isArray(e.location) ? e.location[0] : e.location;
    return {
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      city: location?.city ?? null,
      sessions: e.event_sessions,
      dateRange: formatEventDateRange(e.event_sessions, location?.timezone ?? "UTC"),
    };
  });

  const { cities, otherEvents } = groupEventsByCity(eventsForGrouping, new Date());

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">
        Events<span className="text-accent">.</span>
      </h1>

      {cities.length === 0 && otherEvents.length === 0 && (
        <p className="mt-6 text-sm text-fg-muted">No upcoming events yet.</p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {cities.map((cityGroup) => (
          <div key={cityGroup.city}>
            <h2 className="text-sm font-medium">{cityGroup.city}</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {cityGroup.events.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="block rounded border border-border px-4 py-3 hover:bg-active"
                  >
                    <p className="font-medium">{event.title}</p>
                    {event.dateRange && (
                      <p className="text-sm text-fg-muted">{event.dateRange}</p>
                    )}
                    <EventTypeBadge eventType={event.eventType} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {otherEvents.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium">Other events</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {otherEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-border px-4 py-3 hover:bg-active"
                >
                  <p className="font-medium">{event.title}</p>
                  {event.dateRange && (
                    <p className="text-sm text-fg-muted">{event.dateRange}</p>
                  )}
                  <EventTypeBadge eventType={event.eventType} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
