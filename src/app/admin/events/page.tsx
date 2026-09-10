import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import EventTypeBadge from "@/components/EventTypeBadge";

export const metadata: Metadata = { title: "Events" };

export default async function AdminEventsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  if (!membership) {
    return null; // admin/layout.tsx already handles the no-membership state.
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("org_id", membership.orgId)
    .order("name");

  const locationIds = (locations ?? []).map((l) => l.id);

  const { data: events } =
    locationIds.length > 0
      ? await supabase
          .from("events")
          .select("id, title, event_type, status, location_id, event_sessions(start_time)")
          .in("location_id", locationIds)
          .order("title")
      : { data: [] };

  const eventsByLocation = new Map<string, typeof events>();
  for (const event of events ?? []) {
    const existing = eventsByLocation.get(event.location_id) ?? [];
    existing.push(event);
    eventsByLocation.set(event.location_id, existing);
  }

  return (
    <div>
      <h1 className="text-lg font-medium">{membership.orgName} — Events</h1>

      {(!locations || locations.length === 0) && (
        <p className="mt-4 text-sm text-fg-muted">
          No locations yet. Add one from the{" "}
          <Link href="/admin" className="underline">
            Locations
          </Link>{" "}
          tab first.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {(locations ?? []).map((location) => {
          const locationEvents = eventsByLocation.get(location.id) ?? [];
          return (
            <div key={location.id}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">{location.name}</h2>
                <Link
                  href={`/admin/locations/${location.id}/events`}
                  className="text-sm text-link underline"
                >
                  Manage &rarr;
                </Link>
              </div>

              {locationEvents.length === 0 ? (
                <p className="mt-1 text-sm text-fg-muted">No events yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {locationEvents.map((event) => (
                    <li key={event.id}>
                      <Link
                        href={`/admin/locations/${location.id}/events/${event.id}`}
                        className="block rounded border border-border px-4 py-3 hover:bg-active"
                      >
                        <p className="font-medium">{event.title}</p>
                        <div className="mt-1">
                          <EventTypeBadge eventType={event.event_type} />
                        </div>
                        <p className="text-sm text-fg-muted">
                          {event.status} ·{" "}
                          {event.event_sessions.length} session
                          {event.event_sessions.length === 1 ? "" : "s"}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
