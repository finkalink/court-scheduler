import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  updateEvent,
  addEventSession,
  removeEventSession,
  markRegistrationPaid,
  markRegistrationRefunded,
} from "@/app/admin/eventActions";
import { assembleEventTeam } from "@/app/admin/eventTeamActions";
import BlindDraw from "@/components/BlindDraw";
import SuccessBanner from "@/components/SuccessBanner";
import EventTypeBadge from "@/components/EventTypeBadge";
import { buttonClass } from "@/lib/buttonStyles";
import { formatBookingDate } from "@/lib/dateFormat";
import { formatCents } from "@/lib/money";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("title")
    .eq("id", eventId)
    .maybeSingle();
  return { title: event?.title ?? "Event" };
}

export default async function AdminEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    event_added?: string;
    event_saved?: string;
    event_error?: string;
    session_added?: string;
    session_removed?: string;
    session_error?: string;
    team_assembled?: string;
    assemble_error?: string;
    blind_draw_committed?: string;
    blind_draw_error?: string;
    payment_marked?: string;
    payment_error?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const {
    event_added,
    event_saved,
    event_error,
    session_added,
    session_removed,
    session_error,
    team_assembled,
    assemble_error,
    blind_draw_committed,
    blind_draw_error,
    payment_marked,
    payment_error,
  } = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, timezone, organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const org = Array.isArray(location.organization) ? location.organization[0] : location.organization;
  const hasVenmoHandle = Boolean(org?.venmo_handle);

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, registration_mode, team_formation, capacity, fee_cents, status, best_of_sets, points_per_set, win_by"
    )
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

  const { data: registrantProfiles } =
    event.registration_mode === "team" && event.team_formation === "admin_assembled"
      ? await supabase.rpc("list_event_registrant_profiles", { check_event_id: eventId })
      : { data: null };
  const skillLevelByUserId = new Map(
    (registrantProfiles ?? []).map(
      (r: { user_id: string; skill_level: string | null }) => [r.user_id, r.skill_level]
    )
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

  const { data: registrations } =
    event.fee_cents
      ? await supabase
          .from("event_registrations")
          .select("id, status, payment_status, display_name, team:event_teams(name)")
          .eq("event_id", eventId)
          .or("status.neq.cancelled,payment_status.in.(paid,refunded)")
          .order("registered_at")
      : { data: null };

  // Registrant roster, always shown regardless of fee -- distinct from the
  // fee-gated "Registrants & Payments" list above, which is about payment
  // status, not who's actually on a team.
  const { data: teams } =
    event.registration_mode === "team"
      ? await supabase
          .from("event_teams")
          .select("id, name, members:event_team_members(display_name), registration:event_registrations(status)")
          .eq("event_id", eventId)
          .order("name")
      : { data: null };

  const { data: individualRegistrations } =
    event.registration_mode === "individual"
      ? await supabase
          .from("event_registrations")
          .select("id, status, display_name")
          .eq("event_id", eventId)
          .neq("status", "cancelled")
          .order("registered_at")
      : { data: null };

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events`} className="text-sm underline">
        &larr; Events
      </Link>

      <h1 className="mt-4 text-lg font-medium">{event.title}</h1>
      <div className="mt-1">
        <EventTypeBadge eventType={event.event_type} />
      </div>
      <p className="text-sm text-fg-muted">{event.status}</p>
      <p className="mt-2">
        <Link href={`/admin/locations/${locationId}/events/${eventId}/bracket`} className="text-sm underline">
          Manage Bracket &rarr;
        </Link>
      </p>

      {event_added && <SuccessBanner>Event created — add sessions below.</SuccessBanner>}
      {event_saved && <SuccessBanner>Event saved.</SuccessBanner>}
      {event_error && (
        <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
          {event_error}
        </p>
      )}
      {session_added && <SuccessBanner>Session added.</SuccessBanner>}
      {session_removed && <SuccessBanner>Session removed.</SuccessBanner>}
      {session_error && (
        <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
          {session_error}
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Registrants</h2>
      {event.registration_mode === "team" && (!teams || teams.length === 0) && (
        <p className="mt-1 text-sm text-fg-muted">No teams registered yet.</p>
      )}
      {event.registration_mode === "team" && teams && teams.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {teams.map((team) => {
            const registration = Array.isArray(team.registration) ? team.registration[0] : team.registration;
            return (
              <li key={team.id} className="rounded border border-border px-4 py-2 text-sm">
                <p className="font-medium">
                  {team.name}
                  {registration?.status === "waitlisted" && (
                    <span className="ml-1 text-xs italic text-fg-muted">(waitlisted)</span>
                  )}
                  {registration?.status === "cancelled" && (
                    <span className="ml-1 text-xs italic text-fg-muted">(cancelled)</span>
                  )}
                </p>
                <p className="text-xs text-fg-muted">
                  {team.members.length === 0
                    ? "No roster yet"
                    : team.members.map((m) => m.display_name).join(", ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {event.registration_mode === "individual" && (!individualRegistrations || individualRegistrations.length === 0) && (
        <p className="mt-1 text-sm text-fg-muted">No registrants yet.</p>
      )}
      {event.registration_mode === "individual" && individualRegistrations && individualRegistrations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {individualRegistrations.map((reg) => (
            <li key={reg.id} className="rounded border border-border px-4 py-2 text-sm">
              {reg.display_name ?? "Registrant"}
              {reg.status === "waitlisted" && <span className="ml-1 text-xs italic text-fg-muted">(waitlisted)</span>}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="w-fit cursor-pointer text-sm underline">Edit event details</summary>
        <form action={updateEvent} className="mt-2 flex max-w-sm flex-col gap-3">
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input name="title" defaultValue={event.title} required className="rounded border border-border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <textarea
              name="description"
              defaultValue={event.description ?? ""}
              className="rounded border border-border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              name="event_type"
              defaultValue={event.event_type}
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
              defaultValue={event.registration_mode}
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
              defaultValue={event.team_formation ?? "self_formed"}
              className="rounded border border-border bg-card px-3 py-2"
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
              className="rounded border border-border px-3 py-2"
            />
          </label>
          {hasVenmoHandle ? (
            <label className="flex flex-col gap-1 text-sm">
              Fee (blank = free)
              <input
                name="fee_dollars"
                type="number"
                min="0"
                step="0.01"
                defaultValue={event.fee_cents ? (event.fee_cents / 100).toFixed(2) : ""}
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
              defaultValue={event.status}
              className="rounded border border-border bg-card px-3 py-2"
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

          <p className="mt-2 text-sm font-medium">Match scoring</p>
          <label className="flex flex-col gap-1 text-sm">
            Sets per match
            <select
              name="best_of_sets"
              defaultValue={event.best_of_sets}
              className="rounded border border-border bg-card px-3 py-2"
            >
              <option value={1}>Best of 1</option>
              <option value={3}>Best of 3</option>
              <option value={5}>Best of 5</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Points to win a set
            <input
              name="points_per_set"
              type="number"
              min="1"
              defaultValue={event.points_per_set}
              className="rounded border border-border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Win by
            <input
              name="win_by"
              type="number"
              min="1"
              defaultValue={event.win_by}
              className="rounded border border-border px-3 py-2"
            />
          </label>

          <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
            Save
          </button>
        </form>
      </details>

      <h2 className="mt-10 text-lg font-medium">Sessions</h2>
      {(!sessions || sessions.length === 0) && (
        <p className="mt-1 text-sm text-fg-muted">No sessions scheduled yet.</p>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {(sessions ?? []).map((session) => {
          const court = Array.isArray(session.court) ? session.court[0] : session.court;
          return (
            <li
              key={session.id}
              className="flex items-center justify-between rounded border border-border px-4 py-2"
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
                <button type="submit" className="text-xs text-error-fg underline">
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
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Court
          <select name="court_id" required className="rounded border border-border bg-card px-3 py-2 text-sm">
            {(courts ?? []).map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Label (optional)
          <input name="label" placeholder="Round 1" className="rounded border border-border px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Start
          <input type="datetime-local" name="start_time" required className="rounded border border-border px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          End
          <input type="datetime-local" name="end_time" required className="rounded border border-border px-3 py-2 text-sm" />
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Add Session
        </button>
      </form>

      {event.registration_mode === "team" && event.team_formation === "admin_assembled" && (
        <>
          <h2 className="mt-10 text-lg font-medium">Assemble Teams</h2>
          {team_assembled && <SuccessBanner>Team created.</SuccessBanner>}
          {assemble_error && (
            <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
              {assemble_error}
            </p>
          )}
          {(!ungroupedRegistrants || ungroupedRegistrants.length === 0) && (
            <p className="mt-1 text-sm text-fg-muted">No ungrouped registrants right now.</p>
          )}
          {ungroupedRegistrants && ungroupedRegistrants.length > 0 && (
            <form action={assembleEventTeam} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="event_id" value={event.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <label className="flex flex-col gap-1 text-sm">
                Team name
                <input name="team_name" required className="max-w-sm rounded border border-border px-3 py-2" />
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
                className={`w-fit ${buttonClass("primary")}`}
              >
                Create Team
              </button>
            </form>
          )}
        </>
      )}

      {event.registration_mode === "team" && event.team_formation === "admin_assembled" && (
        <>
          <h2 className="mt-10 text-lg font-medium">Blind Draw</h2>
          {blind_draw_committed && (
            <SuccessBanner>Drew {blind_draw_committed} team{blind_draw_committed === "1" ? "" : "s"}.</SuccessBanner>
          )}
          {blind_draw_error && (
            <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
              {blind_draw_error}
            </p>
          )}
          {(!ungroupedRegistrants || ungroupedRegistrants.length === 0) && (
            <p className="mt-1 text-sm text-fg-muted">No ungrouped registrants right now.</p>
          )}
          {ungroupedRegistrants && ungroupedRegistrants.length > 0 && (
            <BlindDraw
              eventId={event.id}
              locationId={locationId}
              registrants={ungroupedRegistrants.map((reg) => ({
                id: reg.id,
                displayName: reg.user_id ? emailByUserId.get(reg.user_id) ?? reg.user_id : "Unknown",
                skillLevel: (reg.user_id && skillLevelByUserId.get(reg.user_id)) || null,
              }))}
            />
          )}
        </>
      )}

      {event.fee_cents && (
        <>
          <h2 className="mt-10 text-lg font-medium">Registrants &amp; Payments</h2>
          <p className="text-sm text-fg-muted">Fee: {formatCents(event.fee_cents)}</p>
          {payment_marked && <SuccessBanner>Payment status updated.</SuccessBanner>}
          {payment_error && (
            <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
              {payment_error}
            </p>
          )}
          {(!registrations || registrations.length === 0) && (
            <p className="mt-1 text-sm text-fg-muted">No registrants yet.</p>
          )}
          <ul className="mt-4 flex flex-col gap-2">
            {(registrations ?? []).map((reg) => {
              const team = Array.isArray(reg.team) ? reg.team[0] : reg.team;
              const name = team?.name ?? reg.display_name ?? "Registrant";
              return (
                <li
                  key={reg.id}
                  className="flex items-center justify-between rounded border border-border px-4 py-2"
                >
                  <span className="text-sm">
                    {name}
                    {reg.status === "cancelled" && <span className="ml-1 text-xs italic text-fg-muted">(cancelled)</span>}
                    {reg.status === "waitlisted" && <span className="ml-1 text-xs italic text-fg-muted">(waitlisted)</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={
                        reg.payment_status === "paid"
                          ? "rounded bg-success-bg px-2 py-1 text-xs text-success-fg"
                          : reg.payment_status === "refunded"
                            ? "rounded bg-active px-2 py-1 text-xs text-fg-muted"
                            : "rounded bg-status px-2 py-1 text-xs text-status-fg"
                      }
                    >
                      {reg.payment_status === "paid"
                        ? "Paid"
                        : reg.payment_status === "refunded"
                          ? "Refunded"
                          : "Pending"}
                    </span>
                    {reg.payment_status === "pending" && (
                      <form action={markRegistrationPaid}>
                        <input type="hidden" name="registration_id" value={reg.id} />
                        <input type="hidden" name="event_id" value={event.id} />
                        <input type="hidden" name="location_id" value={locationId} />
                        <button type="submit" className="text-xs underline">
                          Mark Paid
                        </button>
                      </form>
                    )}
                    {reg.payment_status === "paid" && (
                      <form action={markRegistrationRefunded}>
                        <input type="hidden" name="registration_id" value={reg.id} />
                        <input type="hidden" name="event_id" value={event.id} />
                        <input type="hidden" name="location_id" value={locationId} />
                        <button type="submit" className="text-xs text-error-fg underline">
                          Mark Refunded
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
