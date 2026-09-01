import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  generateBracket,
  regenerateBracket,
  recordMatchResult,
  editMatch,
  autoAssignSessions,
  withdrawRegistration,
} from "@/app/admin/eventMatchActions";
import { computeStandings } from "@/lib/standings";
import { nextPowerOf2 } from "@/lib/bracketGeneration";
import SuccessBanner from "@/components/SuccessBanner";

export default async function AdminBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    bracket_generated?: string;
    bracket_reset?: string;
    result_saved?: string;
    match_edited?: string;
    sessions_assigned?: string;
    sessions_total?: string;
    withdrawn?: string;
    generate_error?: string;
    result_error?: string;
    review_needed?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const sp = await searchParams;
  const reviewNeededIds = sp.review_needed ? sp.review_needed.split(",") : [];
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, registration_mode")
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

  const nameByRegistrationId = new Map(
    (registrations ?? []).map((r) => {
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
    .in("match_id", (matches ?? []).map((m) => m.id).length > 0 ? (matches ?? []).map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]);

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId)
    .order("start_time");

  const eliminationBracketSize = nextPowerOf2((registrations ?? []).length);
  const bracketsPresent = Array.from(new Set((matches ?? []).map((m) => m.bracket)));
  const unscheduledCount = (matches ?? []).filter((m) => m.status === "pending" && !m.session_id).length;
  const unusedSessionCount = (sessions ?? []).filter((s) => !(matches ?? []).some((m) => m.session_id === s.id)).length;
  const anyCompleted = (matches ?? []).some((m) => m.status === "completed");

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/events/${eventId}`} className="text-sm underline">
        &larr; {event.title}
      </Link>
      <h1 className="mt-4 text-lg font-medium">Bracket</h1>

      {sp.bracket_generated && <SuccessBanner>Bracket generated.</SuccessBanner>}
      {sp.bracket_reset && <SuccessBanner>Bracket reset.</SuccessBanner>}
      {sp.result_saved && <SuccessBanner>Result saved.</SuccessBanner>}
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
      {(sp.generate_error || sp.result_error) && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {sp.generate_error || sp.result_error}
        </p>
      )}
      {reviewNeededIds.length > 0 && (
        <div className="mt-2 rounded bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
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
      )}

      {(!matches || matches.length === 0) && (
        <form action={generateBracket} className="mt-6 flex max-w-md flex-col gap-3">
          <input type="hidden" name="event_id" value={eventId} />
          <input type="hidden" name="location_id" value={locationId} />
          <label className="flex flex-col gap-1 text-sm">
            Format
            <select name="format" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="pool_play">Pool play</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Seeding
            <select name="seeding" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="registration_order">Registration order</option>
              <option value="random">Random</option>
              <option value="manual">Manual (set seed numbers below)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Bye handling (single/double elimination only)
            <select name="bye_mode" className="rounded border px-3 py-2 dark:bg-neutral-900">
              <option value="auto">Auto (top seeds get byes)</option>
              <option value="manual">Manual (choose bye seats below)</option>
            </select>
          </label>
          <p className="text-xs text-gray-600 dark:text-neutral-400">
            Registered: {(registrations ?? []).length}. If elimination, the bracket rounds up to{" "}
            {eliminationBracketSize} slots ({eliminationBracketSize - (registrations ?? []).length} byes).
          </p>

          <div>
            <p className="text-xs text-gray-600 dark:text-neutral-400">
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
                    className="w-16 rounded border px-2 py-1"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-600 dark:text-neutral-400">
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
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              Pool assignment (used only when format is Pool Play)
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {(registrations ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{nameByRegistrationId.get(r.id)}</span>
                  <select name={`pool_for_${r.id}`} defaultValue="pool_a" className="rounded border px-2 py-1 dark:bg-neutral-900">
                    <option value="pool_a">Pool A</option>
                    <option value="pool_b">Pool B</option>
                    <option value="pool_c">Pool C</option>
                    <option value="pool_d">Pool D</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
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
              <button type="submit" className="rounded border px-3 py-2 text-sm dark:border-neutral-700">
                Auto-assign to sessions ({unscheduledCount} unscheduled, {unusedSessionCount} sessions
                available)
              </button>
            </form>
          )}

          {bracketsPresent.map((bracket) => {
            const bracketMatches = (matches ?? []).filter((m) => m.bracket === bracket);
            const registrationIdsInBracket = Array.from(
              new Set(
                bracketMatches.flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id]).filter((id): id is string => Boolean(id))
              )
            );
            const standings =
              bracket !== "winners" && bracket !== "losers" && bracket !== "playoff"
                ? computeStandings(bracketMatches, sets ?? [], registrationIdsInBracket)
                : null;

            return (
              <div key={bracket} className="mt-8">
                <h2 className="text-lg font-medium capitalize">{bracket.replace(/_/g, " ")}</h2>

                {standings && (
                  <table className="mt-2 w-full max-w-md text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-600 dark:text-neutral-400">
                        <th>Team</th>
                        <th>W</th>
                        <th>L</th>
                        <th>+/-</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row) => (
                        <tr key={row.registrationId}>
                          <td>{nameByRegistrationId.get(row.registrationId) ?? "Unknown"}</td>
                          <td>{row.wins}</td>
                          <td>{row.losses}</td>
                          <td>{row.pointDiff}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <ul className="mt-3 flex flex-col gap-2">
                  {bracketMatches.map((match) => {
                    const session = (sessions ?? []).find((s) => s.id === match.session_id);
                    const sessionCourt = session ? (Array.isArray(session.court) ? session.court[0] : session.court) : null;
                    return (
                      <li key={match.id} className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800">
                        <p className="text-sm">
                          Round {match.round_number} &middot;{" "}
                          {nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                          {nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}
                          {match.winner_registration_id && (
                            <> &mdash; winner: {nameByRegistrationId.get(match.winner_registration_id)}</>
                          )}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-neutral-400">
                          {match.status}
                          {match.is_bye ? " (bye)" : ""}
                          {match.is_forfeit ? " (forfeit)" : ""}
                          {session && (
                            <>
                              {" "}
                              &middot; {session.label ? `${session.label} -- ` : ""}
                              {sessionCourt?.name}
                            </>
                          )}
                        </p>
                        {match.admin_note && <p className="text-xs italic text-gray-600 dark:text-neutral-400">{match.admin_note}</p>}

                        {match.status !== "completed" && match.team_a_registration_id && match.team_b_registration_id && (
                          <details className="mt-2">
                            <summary className="w-fit cursor-pointer text-xs underline">Enter Result</summary>
                            <form action={recordMatchResult} className="mt-2 flex max-w-sm flex-col gap-2">
                              <input type="hidden" name="match_id" value={match.id} />
                              <input type="hidden" name="event_id" value={eventId} />
                              <input type="hidden" name="location_id" value={locationId} />
                              {[1, 2, 3, 4, 5].map((n) => (
                                <div key={n} className="flex items-center gap-2 text-xs">
                                  <span className="w-10">Set {n}</span>
                                  <input name={`set_${n}_a`} type="number" min="0" className="w-16 rounded border px-2 py-1" />
                                  <span>-</span>
                                  <input name={`set_${n}_b`} type="number" min="0" className="w-16 rounded border px-2 py-1" />
                                </div>
                              ))}
                              <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" name="forfeit" /> Forfeit / walkover instead
                              </label>
                              <select name="forfeit_winner" className="rounded border px-2 py-1 text-xs dark:bg-neutral-900">
                                <option value="">Forfeit winner (if checked above)</option>
                                <option value={match.team_a_registration_id}>
                                  {nameByRegistrationId.get(match.team_a_registration_id)}
                                </option>
                                <option value={match.team_b_registration_id}>
                                  {nameByRegistrationId.get(match.team_b_registration_id)}
                                </option>
                              </select>
                              <button type="submit" className="w-fit rounded bg-black px-3 py-1.5 text-xs text-white">
                                Save Result
                              </button>
                            </form>
                          </details>
                        )}

                        <details className="mt-2">
                          <summary className="w-fit cursor-pointer text-xs underline">Edit Match</summary>
                          <form action={editMatch} className="mt-2 flex max-w-sm flex-col gap-2">
                            <input type="hidden" name="match_id" value={match.id} />
                            <input type="hidden" name="event_id" value={eventId} />
                            <input type="hidden" name="location_id" value={locationId} />
                            <label className="flex flex-col gap-1 text-xs">
                              Side A
                              <select
                                name="team_a_registration_id"
                                defaultValue={match.team_a_registration_id ?? ""}
                                className="rounded border px-2 py-1 dark:bg-neutral-900"
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
                                className="rounded border px-2 py-1 dark:bg-neutral-900"
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
                                className="rounded border px-2 py-1 dark:bg-neutral-900"
                              >
                                <option value="">-- none --</option>
                                {match.team_a_registration_id && (
                                  <option value={match.team_a_registration_id}>{nameByRegistrationId.get(match.team_a_registration_id)}</option>
                                )}
                                {match.team_b_registration_id && (
                                  <option value={match.team_b_registration_id}>{nameByRegistrationId.get(match.team_b_registration_id)}</option>
                                )}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                              Session
                              <select
                                name="session_id"
                                defaultValue={match.session_id ?? ""}
                                className="rounded border px-2 py-1 dark:bg-neutral-900"
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
                              <input name="admin_note" defaultValue={match.admin_note ?? ""} className="rounded border px-2 py-1" />
                            </label>
                            <button type="submit" className="w-fit rounded border px-3 py-1.5 text-xs dark:border-neutral-700">
                              Save Changes
                            </button>
                          </form>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {!anyCompleted && (
            <form action={regenerateBracket} className="mt-6">
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="location_id" value={locationId} />
              <button type="submit" className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
                Regenerate Bracket
              </button>
            </form>
          )}
        </>
      )}

      <h2 className="mt-10 text-lg font-medium">Registrants</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {(registrations ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border border-gray-300 px-4 py-2 text-sm dark:border-neutral-800">
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
                <select name="substitute_registration_id" className="rounded border px-2 py-1 text-xs dark:bg-neutral-900">
                  <option value="">-- pick substitute --</option>
                  {(registrations ?? [])
                    .filter((other) => other.id !== r.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {nameByRegistrationId.get(other.id)}
                      </option>
                    ))}
                </select>
                <button type="submit" className="w-fit rounded border px-3 py-1.5 text-xs dark:border-neutral-700">
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
