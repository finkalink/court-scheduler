import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { updateEvent, addEventSession, removeEventSession } from "@/app/admin/eventActions";
import { assembleEventTeam } from "@/app/admin/eventTeamActions";
import SuccessBanner from "@/components/SuccessBanner";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function AdminEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    event_added?: string;
    event_saved?: string;
    session_added?: string;
    session_removed?: string;
    session_error?: string;
    team_assembled?: string;
    assemble_error?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const {
    event_added,
    event_saved,
    session_added,
    session_removed,
    session_error,
    team_assembled,
    assemble_error,
  } = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, timezone")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const { data: event } = await supabase
    .from("events")
    .select("id, title, description, event_type, registration_mode, team_formation, capacity, status")
    .eq("id", eventId)
    .eq("location_id", locationId)
    .single();

  if (!event) {
    notFound();
  }

  const { data: ungroupedRegistrants } =
    event.registration_mode === "team" && event.team_formation === "admin_assembled"
      ? await supabase
          .from("event_registrations")
          .select("id, status, user_id")
          .eq("event_id", eventId)
          .is("team_id", null)
          .neq("status", "cancelled")
      : { data: null };

  const { data: registrantEmails } =
    event.registration_mode === "team" && event.team_formation === "admin_assembled"
      ? await supabase.rpc("list_event_registrant_emails", { check_event_id: eventId })
      : { data: null };
  const emailByUserId = new Map(
    (registrantEmails ?? []).map((r: { user_id: string; email: string }) => [r.user_id, r.email])
  );

  const { data: courts } = await supabase
    .from("courts")
    .select("id, name")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .order("name");

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, end_time, label, court:courts(name)")
    .eq("event_id", eventId)
    .order("start_time");

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events`} className="text-sm underline">
        &larr; Events
      </Link>

      <h1 className="mt-4 text-lg font-medium">{event.title}</h1>
      <p className="text-sm text-gray-600">
        {EVENT_TYPE_LABELS[event.event_type]} · {event.status}
      </p>

      {event_added && <SuccessBanner>Event created — add sessions below.</SuccessBanner>}
      {event_saved && <SuccessBanner>Event saved.</SuccessBanner>}
      {session_added && <SuccessBanner>Session added.</SuccessBanner>}
      {session_removed && <SuccessBanner>Session removed.</SuccessBanner>}
      {session_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {session_error}
        </p>
      )}

      <details className="mt-4">
        <summary className="w-fit cursor-pointer text-sm underline">Edit event details</summary>
        <form action={updateEvent} className="mt-2 flex max-w-sm flex-col gap-3">
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input name="title" defaultValue={event.title} required className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <textarea
              name="description"
              defaultValue={event.description ?? ""}
              className="rounded border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              name="event_type"
              defaultValue={event.event_type}
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
              defaultValue={event.registration_mode}
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
              defaultValue={event.team_formation ?? "self_formed"}
              className="rounded border px-3 py-2 dark:bg-neutral-900"
            >
              <option value="self_formed">Players self-form teams</option>
              <option value="admin_assembled">We assemble teams</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Capacity (blank = unlimited)
            <input
              name="capacity"
              type="number"
              min="1"
              defaultValue={event.capacity ?? ""}
              className="rounded border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              name="status"
              defaultValue={event.status}
              className="rounded border px-3 py-2 dark:bg-neutral-900"
            >
              <option value="draft">Draft (hidden from players)</option>
              <option value="published">Published</option>
              <option value="registration_open">Registration Open</option>
              <option value="registration_closed">Registration Closed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
            Save
          </button>
        </form>
      </details>

      <h2 className="mt-10 text-lg font-medium">Sessions</h2>
      {(!sessions || sessions.length === 0) && (
        <p className="mt-1 text-sm text-gray-600">No sessions scheduled yet.</p>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {(sessions ?? []).map((session) => {
          const court = Array.isArray(session.court) ? session.court[0] : session.court;
          return (
            <li
              key={session.id}
              className="flex items-center justify-between rounded border border-gray-300 px-4 py-2 dark:border-neutral-800"
            >
              <span className="text-sm">
                {session.label ? `${session.label} — ` : ""}
                {court?.name} · {formatBookingDate(session.start_time, location.timezone)} ·{" "}
                {formatInTimeZone(new Date(session.start_time), location.timezone, "h:mm a")} –{" "}
                {formatInTimeZone(new Date(session.end_time), location.timezone, "h:mm a")}
              </span>
              <form action={removeEventSession}>
                <input type="hidden" name="session_id" value={session.id} />
                <input type="hidden" name="event_id" value={event.id} />
                <input type="hidden" name="location_id" value={locationId} />
                <button type="submit" className="text-xs text-red-700 underline dark:text-red-400">
                  Remove
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      <form action={addEventSession} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="event_id" value={event.id} />
        <input type="hidden" name="location_id" value={locationId} />
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Court
          <select name="court_id" required className="rounded border px-3 py-2 text-sm dark:bg-neutral-900">
            {(courts ?? []).map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Label (optional)
          <input name="label" placeholder="Round 1" className="rounded border px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Start
          <input type="datetime-local" name="start_time" required className="rounded border px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          End
          <input type="datetime-local" name="end_time" required className="rounded border px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
          Add Session
        </button>
      </form>

      {event.registration_mode === "team" && event.team_formation === "admin_assembled" && (
        <>
          <h2 className="mt-10 text-lg font-medium">Assemble Teams</h2>
          {team_assembled && <SuccessBanner>Team created.</SuccessBanner>}
          {assemble_error && (
            <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {assemble_error}
            </p>
          )}
          {(!ungroupedRegistrants || ungroupedRegistrants.length === 0) && (
            <p className="mt-1 text-sm text-gray-600">No ungrouped registrants right now.</p>
          )}
          {ungroupedRegistrants && ungroupedRegistrants.length > 0 && (
            <form action={assembleEventTeam} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="event_id" value={event.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <label className="flex flex-col gap-1 text-sm">
                Team name
                <input name="team_name" required className="max-w-sm rounded border px-3 py-2" />
              </label>
              <div className="flex flex-col gap-1">
                {ungroupedRegistrants.map((reg) => (
                  <label key={reg.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="registration_id" value={reg.id} />
                    {reg.user_id ? emailByUserId.get(reg.user_id) ?? reg.user_id : "Unknown"}
                    {reg.status === "waitlisted" ? " (waitlisted)" : ""}
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="w-fit rounded bg-black px-4 py-2 text-sm text-white"
              >
                Create Team
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
