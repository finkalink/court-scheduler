import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, status, capacity, location:locations(id, name, timezone, organization:organizations(id, name)), event_sessions(id, start_time, end_time, label, court:courts(name))"
    )
    .eq("id", eventId)
    .neq("status", "draft")
    .single();

  if (!event) {
    notFound();
  }

  const location = Array.isArray(event.location) ? event.location[0] : event.location;
  const org = location
    ? Array.isArray(location.organization)
      ? location.organization[0]
      : location.organization
    : null;
  const timezone = location?.timezone ?? "UTC";
  const sessions = [...event.event_sessions].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/events" className="text-sm underline">
        &larr; All events
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{event.title}</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">
        {EVENT_TYPE_LABELS[event.event_type]}
        {location && ` · ${location.name}`}
        {org?.id && (
          <>
            {" · "}
            <Link href={`/clubs/${org.id}`} className="underline decoration-dotted">
              {org.name}
            </Link>
          </>
        )}
      </p>

      {event.description && <p className="mt-3 text-sm">{event.description}</p>}
      {event.capacity && (
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">Capacity: {event.capacity}</p>
      )}
      {event.status === "cancelled" && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          This event has been cancelled.
        </p>
      )}

      <h2 className="mt-6 text-lg font-medium">Sessions</h2>
      {sessions.length === 0 && (
        <p className="mt-1 text-sm text-gray-600">No sessions scheduled yet.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {sessions.map((session) => {
          const court = Array.isArray(session.court) ? session.court[0] : session.court;
          return (
            <li
              key={session.id}
              className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800"
            >
              {session.label && <p className="text-sm font-medium">{session.label}</p>}
              <p className="text-sm">
                {formatBookingDate(session.start_time, timezone)} ·{" "}
                {formatInTimeZone(new Date(session.start_time), timezone, "h:mm a")} –{" "}
                {formatInTimeZone(new Date(session.end_time), timezone, "h:mm a")}
              </p>
              {court?.name && <p className="text-sm text-gray-600">{court.name}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
