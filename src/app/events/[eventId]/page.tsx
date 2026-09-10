import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatBookingDate } from "@/lib/dateFormat";
import { registerForEvent } from "@/app/actions/events";
import InteractiveBracket from "@/components/bracket/InteractiveBracket";
import SuccessBanner from "@/components/SuccessBanner";
import EventTypeBadge from "@/components/EventTypeBadge";
import Avatar from "@/components/Avatar";
import { buttonClass } from "@/lib/buttonStyles";
import { isProfileComplete } from "@/lib/userProfile";
import { formatCents } from "@/lib/money";
import { buildVenmoPaymentUrl } from "@/lib/venmoLink";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
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

function PlayerNameLink({
  href,
  className = "",
  children,
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return href ? (
    <Link href={href} className={`underline decoration-dotted ${className}`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

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
      "id, title, description, event_type, status, capacity, fee_cents, registration_mode, team_formation, location:locations(id, name, timezone, organization:organizations(id, name, venmo_handle)), event_sessions(id, start_time, end_time, label, court:courts(name))"
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

  let myRegistration: { id: string; status: string; payment_status: string; display_name: string | null } | null = null;
  let myTeamName: string | null = null;
  let registeredCount = 0;
  let profileName: string | null = null;
  let profileIncomplete = false;

  if (user) {
    const { data: individualReg } = await supabase
      .from("event_registrations")
      .select("id, status, payment_status, display_name")
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
          .select("id, status, payment_status, display_name")
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
  const venmoHandle = org?.venmo_handle ?? null;
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

  const { data: publicProfiles, error: publicProfilesError } =
    candidateUserIds.length > 0
      ? await supabase.rpc("filter_public_profile_user_ids", { p_user_ids: candidateUserIds })
      : { data: [], error: null };
  if (publicProfilesError) {
    console.error("filter_public_profile_user_ids failed:", publicProfilesError);
  }
  const sharingUserIds = new Set(
    (publicProfiles ?? []).map((p: { id: string }) => p.id)
  );

  // Avatars are unconditional on rosters (unlike sharingUserIds above,
  // which gates the public-stats link) -- see the profile-photos spec.
  const { data: avatarRows, error: avatarRowsError } =
    candidateUserIds.length > 0
      ? await supabase.rpc("get_avatar_urls", { p_user_ids: candidateUserIds })
      : { data: [], error: null };
  if (avatarRowsError) {
    console.error("get_avatar_urls failed:", avatarRowsError);
  }
  const avatarByUserId: Map<string, string> = new Map(
    (avatarRows ?? []).map(
      (r: { user_id: string; avatar_url: string }): [string, string] => [r.user_id, r.avatar_url]
    )
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/events" className="text-sm underline">
        &larr; All events
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{event.title}</h1>
      <div className="mt-2">
        <EventTypeBadge eventType={event.event_type} />
      </div>
      {(location || org?.id) && (
        <p className="mt-1 text-sm text-fg-muted">
          {location && <>{location.name}</>}
          {location && org?.id && " · "}
          {org?.id && (
            <Link href={`/clubs/${org.id}`} className="underline decoration-dotted">
              {org.name}
            </Link>
          )}
        </p>
      )}

      {message && <SuccessBanner>{message}</SuccessBanner>}

      {event.description && <p className="mt-3 text-sm">{event.description}</p>}
      {event.capacity && (
        <p className="mt-1 text-sm text-fg-muted">Capacity: {event.capacity}</p>
      )}
      {event.status === "cancelled" && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">
          This event has been cancelled.
        </p>
      )}

      {event.status !== "cancelled" && (
        <>
          {!user ? (
            <p className="mt-4">
              <a
                href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
                className={buttonClass("primary")}
              >
                Sign in to register
              </a>
            </p>
          ) : alreadyRegistered ? (
            <>
              <p
                className={
                  myRegistration?.status === "waitlisted"
                    ? "mt-4 rounded bg-status p-3 text-sm text-status-fg"
                    : "mt-4 rounded bg-success-bg p-3 text-sm text-success-fg"
                }
              >
                {myTeamName
                  ? `Your team, ${myTeamName}, is ${myRegistration?.status === "waitlisted" ? "on the waitlist" : "registered"}.`
                  : myRegistration?.status === "waitlisted"
                    ? "You're on the waitlist."
                    : "You're registered."}
              </p>
              {myRegistration?.payment_status === "pending" &&
                myRegistration?.status === "registered" &&
                event.fee_cents &&
                venmoHandle && (
                <div className="mt-2 rounded border border-border bg-status p-3 text-sm">
                  <p className="text-status-fg">
                    Payment due: {formatCents(event.fee_cents)} to @{venmoHandle}
                  </p>
                  <a
                    href={buildVenmoPaymentUrl({
                      handle: venmoHandle,
                      amountCents: event.fee_cents,
                      note: `${event.title} — ${myTeamName ?? myRegistration?.display_name ?? "Registration"}`,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-status-fg underline"
                  >
                    Pay with Venmo
                  </a>
                </div>
              )}
              {myRegistration?.payment_status === "paid" && (
                <p className="mt-2 text-sm text-success-fg">Paid ✓</p>
              )}
              {myRegistration?.payment_status === "refunded" && (
                <p className="mt-2 text-sm text-fg-muted">Refunded</p>
              )}
            </>
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
                <p className="mb-3 rounded bg-error-bg p-3 text-sm text-error-fg">
                  {registerError}
                </p>
              )}
              {event.registration_mode === "team" && event.team_formation === "self_formed" ? (
                <form action={registerForEvent} className="flex flex-col gap-3">
                  <input type="hidden" name="event_id" value={event.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Team name
                    <input name="team_name" required className="rounded border border-border px-3 py-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Your display name (shown on the roster)
                    <input
                      name="captain_display_name"
                      defaultValue={profileName ?? ""}
                      required
                      className="rounded border border-border px-3 py-2"
                    />
                  </label>
                  <p className="text-xs text-fg-muted">
                    Teammates (optional) -- each needs a name and their email. If they
                    aren&apos;t registered yet, they&apos;ll show as &quot;Pending&quot;
                    until they sign up with that exact email.
                  </p>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div key={n} className="flex gap-2">
                      <input
                        name={`teammate_name_${n}`}
                        placeholder={`Teammate ${n} name`}
                        className="w-1/2 rounded border border-border px-3 py-2 text-sm"
                      />
                      <input
                        name={`teammate_email_${n}`}
                        type="email"
                        placeholder={`Teammate ${n} email`}
                        className="w-1/2 rounded border border-border px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                  <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
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
                      className="rounded border border-border px-3 py-2"
                    />
                  </label>
                  <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
                    {isFull ? "Join Waitlist" : "Register"}
                  </button>
                </form>
              )}
              {event.capacity != null && (
                <p className="mt-2 text-xs text-fg-muted">
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
                className="rounded border border-border px-4 py-3"
              >
                <p className="text-sm font-medium">{team.name}</p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {team.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm text-fg-muted">
                      <Avatar url={m.user_id ? (avatarByUserId.get(m.user_id) ?? null) : null} size="sm" />
                      <span>
                        <PlayerNameLink
                          href={m.user_id && sharingUserIds.has(m.user_id) ? `/players/${m.user_id}` : null}
                        >
                          {m.display_name}
                        </PlayerNameLink>
                        {!m.user_id && <span className="ml-1 text-xs italic">(pending)</span>}
                      </span>
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
        <p className="mt-1 text-sm text-fg-muted">No sessions scheduled yet.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {sessions.map((session) => {
          const court = Array.isArray(session.court) ? session.court[0] : session.court;
          return (
            <li
              key={session.id}
              className="rounded border border-border px-4 py-3"
            >
              {session.label && <p className="text-sm font-medium">{session.label}</p>}
              <p className="text-sm">
                {formatBookingDate(session.start_time, timezone)} ·{" "}
                {formatInTimeZone(new Date(session.start_time), timezone, "h:mm a")} –{" "}
                {formatInTimeZone(new Date(session.end_time), timezone, "h:mm a")}
              </p>
              {court?.name && <p className="text-sm text-fg-muted">{court.name}</p>}
            </li>
          );
        })}
      </ul>

      {(matches ?? []).length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-medium">Bracket</h2>
          <InteractiveBracket
            eventId={eventId}
            locationId={location?.id ?? ""}
            matches={matches ?? []}
            sets={matchSets ?? []}
            nameByRegistrationId={nameByRegistrationId}
            bestOfSets={3}
            pointsPerSet={21}
            winBy={2}
            interactive={false}
          />
        </>
      )}
    </div>
  );
}
