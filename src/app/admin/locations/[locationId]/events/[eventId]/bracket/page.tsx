import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  generateBracket,
  regenerateBracket,
  editMatch,
  autoAssignSessions,
  withdrawRegistration,
} from "@/app/admin/eventMatchActions";
import { nextPowerOf2 } from "@/lib/bracketGeneration";
import SuccessBanner from "@/components/SuccessBanner";
import InteractiveBracket from "@/components/bracket/InteractiveBracket";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Bracket" };

export default async function AdminBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    bracket_generated?: string;
    bracket_reset?: string;
    match_edited?: string;
    sessions_assigned?: string;
    sessions_total?: string;
    withdrawn?: string;
    generate_error?: string;
    review_needed?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, registration_mode, best_of_sets, points_per_set, win_by")
    .eq("id", eventId)
    .eq("location_id", locationId)
    .single();
  if (!event) notFound();

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select("id, status, user_id, display_name, team:event_teams(id, name)")
    .eq("event_id", eventId)
    .neq("status", "cancelled")
    .order("registered_at");

  const { data: allRegistrationsForNames } = await supabase
    .from("event_registrations")
    .select("id, display_name, team:event_teams(name)")
    .eq("event_id", eventId);

  const nameByRegistrationId = new Map(
    (allRegistrationsForNames ?? []).map((r) => {
      const team = Array.isArray(r.team) ? r.team[0] : r.team;
      return [r.id, team?.name ?? r.display_name ?? "Player"];
    })
  );

  const { data: matches } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .order("bracket")
    .order("round_number")
    .order("slot_in_round");

  const { data: sets } = await supabase
    .from("event_match_sets")
    .select("*")
    .in(
      "match_id",
      (matches ?? []).map((m) => m.id).length > 0 ? (matches ?? []).map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]
    );

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId)
    .order("start_time");

  const eliminationBracketSize = nextPowerOf2((registrations ?? []).length);
  const unscheduledCount = (matches ?? []).filter((m) => m.status === "pending" && !m.session_id).length;
  const unusedSessionCount = (sessions ?? []).filter((s) => !(matches ?? []).some((m) => m.session_id === s.id)).length;
  const anyCompleted = (matches ?? []).some((m) => m.status === "completed" && !m.is_bye);

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events/${eventId}`} className="text-sm underline">
        &larr; {event.title}
      </Link>
      <h1 className="mt-4 text-lg font-medium">Bracket</h1>

      {sp.bracket_generated && <SuccessBanner>Bracket generated.</SuccessBanner>}
      {sp.bracket_reset && <SuccessBanner>Bracket reset.</SuccessBanner>}
      {sp.match_edited && <SuccessBanner>Match updated.</SuccessBanner>}
      {sp.withdrawn && <SuccessBanner>Registration withdrawn.</SuccessBanner>}
      {sp.sessions_assigned && (
        <SuccessBanner>
          {sp.sessions_assigned} of {sp.sessions_total} matches assigned to a session.
          {Number(sp.sessions_assigned) < Number(sp.sessions_total)
            ? " The rest need a session assigned manually below."
            : ""}
        </SuccessBanner>
      )}
      {sp.generate_error && (
        <p className="mt-2 rounded bg-error-bg p-3 text-sm text-error-fg">
          {sp.generate_error}
        </p>
      )}
      {sp.review_needed && (() => {
        const reviewNeededIds = sp.review_needed!.split(",");
        return (
          <div className="mt-2 rounded bg-status p-3 text-sm text-status-fg">
            <p>
              This correction fed into {reviewNeededIds.length} match{reviewNeededIds.length > 1 ? "es" : ""} that{" "}
              {reviewNeededIds.length > 1 ? "were" : "was"} already completed, so it wasn&apos;t auto-updated. Review
              and, if needed, correct it via Edit Match:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {reviewNeededIds.map((id) => {
                const m = (matches ?? []).find((match) => match.id === id);
                if (!m) return <li key={id}>Match {id}</li>;
                return (
                  <li key={id}>
                    {m.bracket} round {m.round_number}: {nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                    {nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {(!matches || matches.length === 0) && (
        <form action={generateBracket} className="mt-6 flex max-w-md flex-col gap-3">
          <input type="hidden" name="event_id" value={eventId} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Format
            <select name="format" className="rounded border border-border bg-card px-3 py-2">
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="pool_play">Pool play</option>
            </select>
          </label>
          <dl className="flex flex-col gap-2 rounded border border-border p-3 text-xs text-fg-muted">
            <div>
              <dt className="font-medium text-fg">Single elimination</dt>
              <dd>One loss and you&apos;re out. Fastest format -- good when court time or the day itself is limited.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Double elimination</dt>
              <dd>A loss drops you to a losers bracket instead of eliminating you outright -- you&apos;re out only after a second loss. Takes longer but gives every team a second chance.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Round robin</dt>
              <dd>Every team plays every other team once; standings are ranked by wins. No eliminations -- best for a small group with time to play a full set of matches.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Pool play</dt>
              <dd>Teams are split into pools and round-robin within their own pool. Use this for a larger field where a full round robin across everyone would take too long.</dd>
            </div>
          </dl>
          <label className="flex flex-col gap-1 text-sm">
            Seeding
            <select name="seeding" className="rounded border border-border bg-card px-3 py-2">
              <option value="registration_order">Registration order</option>
              <option value="random">Random</option>
              <option value="manual">Manual (set seed numbers below)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Bye handling (single/double elimination only)
            <select name="bye_mode" className="rounded border border-border bg-card px-3 py-2">
              <option value="auto">Auto (top seeds get byes)</option>
              <option value="manual">Manual (choose bye seats below)</option>
            </select>
          </label>
          <p className="text-xs text-fg-muted">
            Registered: {(registrations ?? []).length}. If elimination, the bracket rounds up to{" "}
            {eliminationBracketSize} slots ({eliminationBracketSize - (registrations ?? []).length} byes).
          </p>

          <div>
            <p className="text-xs text-fg-muted">
              Seed numbers (used only when Seeding is Manual; lower = better seed)
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {(registrations ?? []).map((r, i) => (
                <label key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{nameByRegistrationId.get(r.id)}</span>
                  <input
                    name={`seed_for_${r.id}`}
                    type="number"
                    min="1"
                    defaultValue={i + 1}
                    className="w-16 rounded border border-border px-2 py-1"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-fg-muted">
              Bye seats (used only when Bye handling is Manual; check exactly{" "}
              {eliminationBracketSize - (registrations ?? []).length} of these seat numbers)
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {Array.from({ length: eliminationBracketSize }, (_, i) => i + 1).map((seatNumber) => (
                <label key={seatNumber} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="bye_seed" value={seatNumber} /> {seatNumber}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-fg-muted">
              Pool assignment (used only when format is Pool Play)
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {(registrations ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{nameByRegistrationId.get(r.id)}</span>
                  <select name={`pool_for_${r.id}`} defaultValue="pool_a" className="rounded border border-border bg-card px-2 py-1">
                    <option value="pool_a">Pool A</option>
                    <option value="pool_b">Pool B</option>
                    <option value="pool_c">Pool C</option>
                    <option value="pool_d">Pool D</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
            Generate Bracket
          </button>
        </form>
      )}

      {matches && matches.length > 0 && (
        <>
          {unscheduledCount > 0 && unusedSessionCount > 0 && (
            <form action={autoAssignSessions} className="mt-4">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border border-border px-3 py-2 text-sm">
                Auto-assign to sessions ({unscheduledCount} unscheduled, {unusedSessionCount} sessions
                available)
              </button>
            </form>
          )}

          <div className="mt-6">
            <InteractiveBracket
              eventId={eventId}
              locationId={locationId}
              matches={matches ?? []}
              sets={sets ?? []}
              nameByRegistrationId={nameByRegistrationId}
              bestOfSets={event.best_of_sets}
              pointsPerSet={event.points_per_set}
              winBy={event.win_by}
              interactive
            />
          </div>

          {!anyCompleted && (
            <form action={regenerateBracket} className="mt-6">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border border-error-fg px-3 py-2 text-sm text-error-fg">
                Regenerate Bracket
              </button>
            </form>
          )}

          <details className="mt-8">
            <summary className="w-fit cursor-pointer text-sm underline">Advanced: edit a match manually</summary>
            <p className="mt-1 text-xs text-fg-muted">
              Directly reassign a match&apos;s sides, winner, or session -- bypasses the normal tap-to-score flow above.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {matches.map((match) => (
                <li key={match.id} className="rounded border border-border px-4 py-3">
                  <p className="text-sm">
                    {match.bracket} round {match.round_number} &middot;{" "}
                    {nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                    {nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}
                  </p>
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer text-xs underline">Edit Match</summary>
                    <form
                      key={`${match.team_a_registration_id}-${match.team_b_registration_id}-${match.winner_registration_id}-${match.session_id}-${match.admin_note}-${match.status}`}
                      action={editMatch}
                      className="mt-2 flex max-w-sm flex-col gap-2"
                    >
                      <input type="hidden" name="match_id" value={match.id} />
                      <input type="hidden" name="event_id" value={eventId} />
                      <input type="hidden" name="location_id" value={locationId} />
                      <label className="flex flex-col gap-1 text-xs">
                        Side A
                        <select
                          name="team_a_registration_id"
                          defaultValue={match.team_a_registration_id ?? ""}
                          className="rounded border border-border bg-card px-2 py-1"
                        >
                          <option value="">-- none --</option>
                          {(registrations ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {nameByRegistrationId.get(r.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Side B
                        <select
                          name="team_b_registration_id"
                          defaultValue={match.team_b_registration_id ?? ""}
                          className="rounded border border-border bg-card px-2 py-1"
                        >
                          <option value="">-- none --</option>
                          {(registrations ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {nameByRegistrationId.get(r.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Winner (leave blank if not decided)
                        <select
                          name="winner_registration_id"
                          defaultValue={match.winner_registration_id ?? ""}
                          className="rounded border border-border bg-card px-2 py-1"
                        >
                          <option value="">-- none --</option>
                          {match.team_a_registration_id && (
                            <option value={match.team_a_registration_id}>
                              {nameByRegistrationId.get(match.team_a_registration_id)}
                            </option>
                          )}
                          {match.team_b_registration_id && (
                            <option value={match.team_b_registration_id}>
                              {nameByRegistrationId.get(match.team_b_registration_id)}
                            </option>
                          )}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Session
                        <select
                          name="session_id"
                          defaultValue={match.session_id ?? ""}
                          className="rounded border border-border bg-card px-2 py-1"
                        >
                          <option value="">-- none --</option>
                          {(sessions ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label ?? s.start_time}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Admin note (shown to players)
                        <input name="admin_note" defaultValue={match.admin_note ?? ""} className="rounded border border-border px-2 py-1" />
                      </label>
                      <button type="submit" className="w-fit rounded border border-border px-3 py-1.5 text-xs">
                        Save Changes
                      </button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <h2 className="mt-10 text-lg font-medium">Registrants</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {(registrations ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border border-border px-4 py-2 text-sm">
            <span>
              {nameByRegistrationId.get(r.id)} ({r.status})
            </span>
            <details>
              <summary className="cursor-pointer text-xs underline">Withdraw</summary>
              <form action={withdrawRegistration} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="registration_id" value={r.id} />
                <input type="hidden" name="event_id" value={eventId} />
                <input type="hidden" name="location_id" value={locationId} />
                <label className="flex items-center gap-1 text-xs">
                  <input type="radio" name="resolution" value="forfeit" defaultChecked /> Opponent advances by forfeit
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input type="radio" name="resolution" value="substitute" /> Substitute a different registration
                </label>
                <select name="substitute_registration_id" className="rounded border border-border bg-card px-2 py-1 text-xs">
                  <option value="">-- pick substitute --</option>
                  {(registrations ?? [])
                    .filter((other) => other.id !== r.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {nameByRegistrationId.get(other.id)}
                      </option>
                    ))}
                </select>
                <button type="submit" className="w-fit rounded border border-border px-3 py-1.5 text-xs">
                  Confirm Withdraw
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
