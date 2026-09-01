import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";
import { registerForEvent } from "@/app/actions/events";
import { computeStandings } from "@/lib/standings";
import MatchCard from "@/components/MatchCard";
import SuccessBanner from "@/components/SuccessBanner";
import { isProfileComplete } from "@/lib/userProfile";

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ register_error?: string; message?: string }>;
}) {
  const { eventId } = await params;
  const { register_error: registerError, message } = await searchParams;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, status, capacity, registration_mode, team_formation, location:locations(id, name, timezone, organization:organizations(id, name)), event_sessions(id, start_time, end_time, label, court:courts(name))"
    )
    .eq("id", eventId)
    .neq("status", "draft")
    .single();

  if (!event) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let myRegistration: { id: string; status: string } | null = null;
  let myTeamName: string | null = null;
  let registeredCount = 0;
  let profileName: string | null = null;
  let profileIncomplete = false;

  if (user) {
    const { data: individualReg } = await supabase
      .from("event_registrations")
      .select("id, status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .maybeSingle();

    if (individualReg) {
      myRegistration = individualReg;
    } else {
      const { data: memberships } = await supabase
        .from("event_team_members")
        .select("team:event_teams!inner(id, name, event_id)")
        .eq("user_id", user.id);

      const myTeamForEvent = (memberships ?? [])
        .map((m) => (Array.isArray(m.team) ? m.team[0] : m.team))
        .find((t) => t?.event_id === eventId);

      if (myTeamForEvent) {
        const { data: teamReg } = await supabase
          .from("event_registrations")
          .select("id, status")
          .eq("event_id", eventId)
          .eq("team_id", myTeamForEvent.id)
          .neq("status", "cancelled")
          .maybeSingle();
        if (teamReg) {
          myRegistration = teamReg;
          myTeamName = myTeamForEvent.name;
        }
      }
    }

    const { data: counts } = await supabase
      .from("event_registration_counts")
      .select("status, count")
      .eq("event_id", eventId);
    registeredCount = (counts ?? []).find((c) => c.status === "registered")?.count ?? 0;

    const { data: profile } = await supabase
      .from("users")
      .select("name, gender, skill_level")
      .eq("id", user.id)
      .single();
    profileName = profile?.name ?? null;
    // Must match the exemption in registerForEvent (src/app/actions/events.ts)
    // exactly -- open_play events don't require a complete profile to
    // register, so the form must render for them regardless.
    profileIncomplete =
      event.event_type !== "open_play" && (!profile || !isProfileComplete(profile));
  }

  const isFull = event.capacity != null && registeredCount >= event.capacity;
  const alreadyRegistered = Boolean(myRegistration);

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

  const { data: teams } =
    event.registration_mode === "team"
      ? await supabase
          .from("event_teams")
          .select("id, name, members:event_team_members(id, display_name, user_id)")
          .eq("event_id", eventId)
          .order("name")
      : { data: null };

  const { data: matches } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .order("bracket")
    .order("round_number")
    .order("slot_in_round");

  const matchIds = (matches ?? []).map((m) => m.id);
  const { data: matchSets } =
    matchIds.length > 0
      ? await supabase.from("event_match_sets").select("*").in("match_id", matchIds)
      : { data: [] };

  const { data: allRegistrations } = await supabase
    .from("event_registrations")
    .select("id, user_id, display_name, team:event_teams(name)")
    .eq("event_id", eventId);
  const nameByRegistrationId = new Map(
    (allRegistrations ?? []).map((r) => {
      const team = Array.isArray(r.team) ? r.team[0] : r.team;
      return [r.id, team?.name ?? r.display_name ?? "Player"];
    })
  );

  const rosterUserIds = (teams ?? [])
    .flatMap((t) => t.members.map((m) => m.user_id))
    .filter((id): id is string => Boolean(id));
  const registrationUserIds = (allRegistrations ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => Boolean(id));
  const candidateUserIds = Array.from(new Set([...rosterUserIds, ...registrationUserIds]));

  const { data: publicProfiles } =
    candidateUserIds.length > 0
      ? await supabase.from("users").select("id").in("id", candidateUserIds).eq("share_stats_publicly", true)
      : { data: [] };
  const sharingUserIds = new Set((publicProfiles ?? []).map((p) => p.id));

  const hrefByRegistrationId = new Map(
    (allRegistrations ?? []).map((r) => [
      r.id,
      r.user_id && sharingUserIds.has(r.user_id) ? `/players/${r.user_id}` : null,
    ])
  );

  const { data: matchSessions } = await supabase
    .from("event_sessions")
    .select("id, start_time, label, court:courts(name)")
    .eq("event_id", eventId);

  const bracketsPresent = Array.from(new Set((matches ?? []).map((m) => m.bracket)));

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

      {message && <SuccessBanner>{message}</SuccessBanner>}

      {event.description && <p className="mt-3 text-sm">{event.description}</p>}
      {event.capacity && (
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">Capacity: {event.capacity}</p>
      )}
      {event.status === "cancelled" && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          This event has been cancelled.
        </p>
      )}

      {event.status !== "cancelled" && (
        <>
          {!user ? (
            <p className="mt-4 text-sm">
              <a
                href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
                className="underline"
              >
                Sign in to register
              </a>
            </p>
          ) : alreadyRegistered ? (
            <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
              {myTeamName
                ? `Your team, ${myTeamName}, is ${myRegistration?.status === "waitlisted" ? "on the waitlist" : "registered"}.`
                : myRegistration?.status === "waitlisted"
                  ? "You're on the waitlist."
                  : "You're registered."}
            </p>
          ) : profileIncomplete ? (
            <p className="mt-4 text-sm">
              Complete your profile to register for this event.{" "}
              <a
                href={`/profile?next=${encodeURIComponent(`/events/${eventId}`)}`}
                className="underline"
              >
                Complete your profile
              </a>
            </p>
          ) : (
            <div className="mt-4">
              {registerError && (
                <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
                  {registerError}
                </p>
              )}
              {event.registration_mode === "team" && event.team_formation === "self_formed" ? (
                <form action={registerForEvent} className="flex flex-col gap-3">
                  <input type="hidden" name="event_id" value={event.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Team name
                    <input name="team_name" required className="rounded border px-3 py-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Your display name (shown on the roster)
                    <input
                      name="captain_display_name"
                      defaultValue={profileName ?? ""}
                      required
                      className="rounded border px-3 py-2"
                    />
                  </label>
                  <p className="text-xs text-gray-600 dark:text-neutral-400">
                    Teammates (optional) -- each needs a name and their email. If they
                    aren&apos;t registered yet, they&apos;ll show as &quot;Pending&quot;
                    until they sign up with that exact email.
                  </p>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div key={n} className="flex gap-2">
                      <input
                        name={`teammate_name_${n}`}
                        placeholder={`Teammate ${n} name`}
                        className="w-1/2 rounded border px-3 py-2 text-sm"
                      />
                      <input
                        name={`teammate_email_${n}`}
                        type="email"
                        placeholder={`Teammate ${n} email`}
                        className="w-1/2 rounded border px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                  <button
                    type="submit"
                    className="w-fit rounded bg-black px-4 py-2 text-sm text-white"
                  >
                    {isFull ? "Join Waitlist" : "Register Team"}
                  </button>
                </form>
              ) : (
                <form action={registerForEvent} className="flex flex-col gap-3">
                  <input type="hidden" name="event_id" value={event.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Display name (shown in results)
                    <input
                      name="display_name"
                      defaultValue={profileName ?? ""}
                      required
                      className="rounded border px-3 py-2"
                    />
                  </label>
                  <button
                    type="submit"
                    className="w-fit rounded bg-black px-4 py-2 text-sm text-white"
                  >
                    {isFull ? "Join Waitlist" : "Register"}
                  </button>
                </form>
              )}
              {event.capacity != null && (
                <p className="mt-2 text-xs text-gray-600 dark:text-neutral-400">
                  {registeredCount} of {event.capacity} spots filled
                </p>
              )}
            </div>
          )}
        </>
      )}

      {event.registration_mode === "team" && teams && teams.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Rosters</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {teams.map((team) => (
              <li
                key={team.id}
                className="rounded border border-gray-300 px-4 py-3 dark:border-neutral-800"
              >
                <p className="text-sm font-medium">{team.name}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {team.members.map((m) => (
                    <li key={m.id} className="text-sm text-gray-600 dark:text-neutral-400">
                      {m.user_id && sharingUserIds.has(m.user_id) ? (
                        <Link href={`/players/${m.user_id}`} className="underline decoration-dotted">
                          {m.display_name}
                        </Link>
                      ) : (
                        m.display_name
                      )}
                      {!m.user_id && <span className="ml-1 text-xs italic">(pending)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
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

      {bracketsPresent.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Bracket</h2>
          {bracketsPresent.map((bracket) => {
            const bracketMatches = (matches ?? []).filter((m) => m.bracket === bracket);
            const isEliminationTree = bracket === "winners" || bracket === "losers" || bracket === "playoff";
            const registrationIdsInBracket = Array.from(
              new Set(
                bracketMatches
                  .flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id])
                  .filter((id): id is string => Boolean(id))
              )
            );
            const standings = !isEliminationTree
              ? computeStandings(bracketMatches, matchSets ?? [], registrationIdsInBracket)
              : null;
            const rounds = Array.from(new Set(bracketMatches.map((m) => m.round_number))).sort((a, b) => a - b);

            return (
              <div key={bracket} className="mt-4">
                <h3 className="text-sm font-medium capitalize">{bracket.replace(/_/g, " ")}</h3>

                {isEliminationTree && (
                  <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
                    {rounds.map((roundNumber) => (
                      <div key={roundNumber} className="flex shrink-0 flex-col gap-2">
                        <p className="sticky top-0 bg-white text-xs font-medium dark:bg-neutral-950">
                          Round {roundNumber}
                        </p>
                        {bracketMatches
                          .filter((m) => m.round_number === roundNumber)
                          .map((m) => {
                            const session = (matchSessions ?? []).find((s) => s.id === m.session_id);
                            const court = session ? (Array.isArray(session.court) ? session.court[0] : session.court) : null;
                            return (
                              <MatchCard
                                key={m.id}
                                roundLabel={`Round ${roundNumber}`}
                                sideAName={nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"}
                                sideBName={nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                                sideAHref={hrefByRegistrationId.get(m.team_a_registration_id ?? "") ?? null}
                                sideBHref={hrefByRegistrationId.get(m.team_b_registration_id ?? "") ?? null}
                                winnerName={m.winner_registration_id ? nameByRegistrationId.get(m.winner_registration_id) ?? null : null}
                                sets={(matchSets ?? []).filter((s) => s.match_id === m.id)}
                                isForfeit={m.is_forfeit}
                                adminNote={m.admin_note}
                                sessionSummary={session ? `${session.label ? session.label + " -- " : ""}${court?.name ?? ""}` : null}
                              />
                            );
                          })}
                      </div>
                    ))}
                  </div>
                )}

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
                          <td>
                            {hrefByRegistrationId.get(row.registrationId) ? (
                              <Link
                                href={hrefByRegistrationId.get(row.registrationId)!}
                                className="underline decoration-dotted"
                              >
                                {nameByRegistrationId.get(row.registrationId) ?? "Unknown"}
                              </Link>
                            ) : (
                              nameByRegistrationId.get(row.registrationId) ?? "Unknown"
                            )}
                          </td>
                          <td>{row.wins}</td>
                          <td>{row.losses}</td>
                          <td>{row.pointDiff}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {!isEliminationTree && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {bracketMatches.map((m) => {
                      const session = (matchSessions ?? []).find((s) => s.id === m.session_id);
                      const court = session ? (Array.isArray(session.court) ? session.court[0] : session.court) : null;
                      const sideAName = nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD";
                      const sideBName = nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD";
                      const winnerName = m.winner_registration_id
                        ? nameByRegistrationId.get(m.winner_registration_id) ?? null
                        : null;
                      return (
                        <li
                          key={m.id}
                          className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-neutral-800"
                        >
                          <p>
                            Round {m.round_number} &middot;{" "}
                            {hrefByRegistrationId.get(m.team_a_registration_id ?? "") ? (
                              <Link
                                href={hrefByRegistrationId.get(m.team_a_registration_id ?? "")!}
                                className={winnerName === sideAName ? "font-medium underline decoration-dotted" : "underline decoration-dotted"}
                              >
                                {sideAName}
                              </Link>
                            ) : (
                              <span className={winnerName === sideAName ? "font-medium" : ""}>{sideAName}</span>
                            )}{" "}
                            vs{" "}
                            {hrefByRegistrationId.get(m.team_b_registration_id ?? "") ? (
                              <Link
                                href={hrefByRegistrationId.get(m.team_b_registration_id ?? "")!}
                                className={winnerName === sideBName ? "font-medium underline decoration-dotted" : "underline decoration-dotted"}
                              >
                                {sideBName}
                              </Link>
                            ) : (
                              <span className={winnerName === sideBName ? "font-medium" : ""}>{sideBName}</span>
                            )}
                            {m.is_forfeit && " (forfeit)"}
                          </p>
                          {session && (
                            <p className="text-xs text-gray-600 dark:text-neutral-400">
                              {session.label ? `${session.label} -- ` : ""}
                              {formatBookingDate(session.start_time, timezone)} ·{" "}
                              {formatInTimeZone(new Date(session.start_time), timezone, "h:mm a")}
                              {court?.name ? ` · ${court.name}` : ""}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
