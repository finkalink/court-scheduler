import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createEvent } from "@/app/admin/eventActions";
import EventTypeBadge from "@/components/EventTypeBadge";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Manage Events" };

export default async function AdminEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>;
  searchParams: Promise<{ event_error?: string }>;
}) {
  const { locationId } = await params;
  const { event_error } = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const org = Array.isArray(location.organization) ? location.organization[0] : location.organization;
  const hasVenmoHandle = Boolean(org?.venmo_handle);

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

      {event_error && (
        <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
          {event_error}
        </p>
      )}

      {(!events || events.length === 0) && (
        <p className="mt-4 text-sm text-fg-muted">No events yet.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(events ?? []).map((event) => (
          <li key={event.id}>
            <Link
              href={`/admin/locations/${locationId}/events/${event.id}`}
              className="block rounded border border-border px-4 py-3 hover:bg-active"
            >
              <p className="font-medium">{event.title}</p>
              <div className="mt-1">
                <EventTypeBadge eventType={event.event_type} />
              </div>
              <p className="text-sm text-fg-muted">
                {event.status} ·{" "}
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
          <input name="title" required className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            name="event_type"
            defaultValue="tournament"
            className="rounded border border-border bg-card px-3 py-2"
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
            className="rounded border border-border bg-card px-3 py-2"
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
            className="rounded border border-border bg-card px-3 py-2"
          >
            <option value="self_formed">Players self-form teams</option>
            <option value="admin_assembled">We assemble teams</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Capacity (blank = unlimited)
          <input name="capacity" type="number" min="1" className="rounded border border-border px-3 py-2" />
        </label>
        {hasVenmoHandle ? (
          <label className="flex flex-col gap-1 text-sm">
            Fee (blank = free)
            <input
              name="fee_dollars"
              type="number"
              min="0"
              step="0.01"
              placeholder="25.00"
              className="rounded border border-border px-3 py-2"
            />
          </label>
        ) : (
          <p className="text-xs text-fg-muted">
            Set your club&apos;s Venmo handle on the{" "}
            <Link href="/admin" className="underline">
              club dashboard
            </Link>{" "}
            to charge a fee for this event.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue="draft"
            className="rounded border border-border bg-card px-3 py-2"
          >
            <option value="draft">Draft (hidden from players)</option>
            <option value="published">Published</option>
          </select>
        </label>
        <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
          Create Event
        </button>
      </form>
    </div>
  );
}
