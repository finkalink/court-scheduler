import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createEvent } from "@/app/admin/eventActions";
import SuccessBanner from "@/components/SuccessBanner";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function AdminEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>;
  searchParams: Promise<{ event_added?: string }>;
}) {
  const { locationId } = await params;
  const { event_added } = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_type, status, event_sessions(start_time)")
    .eq("location_id", locationId)
    .order("title");

  return (
    <div>
      <Link href={`/admin/locations/${locationId}`} className="text-sm underline">
        &larr; {location.name}
      </Link>

      <h1 className="mt-4 text-lg font-medium">{location.name} — Events</h1>

      {event_added && <SuccessBanner>Event created — add sessions below.</SuccessBanner>}

      {(!events || events.length === 0) && (
        <p className="mt-4 text-sm text-gray-600">No events yet.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(events ?? []).map((event) => (
          <li key={event.id}>
            <Link
              href={`/admin/locations/${locationId}/events/${event.id}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{event.title}</p>
              <p className="text-sm text-gray-600">
                {EVENT_TYPE_LABELS[event.event_type]} · {event.status} ·{" "}
                {event.event_sessions.length} session{event.event_sessions.length === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-medium">Add an Event</h2>
      <form action={createEvent} className="mt-4 flex max-w-sm flex-col gap-3">
        <input type="hidden" name="location_id" value={locationId} />
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input name="title" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            name="event_type"
            defaultValue="tournament"
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="tournament">Tournament</option>
            <option value="league">League</option>
            <option value="open_play">Open Play</option>
            <option value="clinic">Clinic</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Registration
          <select
            name="registration_mode"
            defaultValue="individual"
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="individual">Individual</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Team formation (if team registration)
          <select
            name="team_formation"
            defaultValue="self_formed"
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="self_formed">Players self-form teams</option>
            <option value="admin_assembled">We assemble teams</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Capacity (blank = unlimited)
          <input name="capacity" type="number" min="1" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue="draft"
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="draft">Draft (hidden from players)</option>
            <option value="published">Published</option>
          </select>
        </label>
        <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Create Event
        </button>
      </form>
    </div>
  );
}
