import Link from "next/link";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { cancelEventRegistration } from "@/app/actions/events";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";
import SuccessBanner from "@/components/SuccessBanner";

export default async function MyEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; cancel_error?: string }>;
}) {
  const { cancelled, cancel_error: cancelError } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/events/registrations");
  }

  // Individual registrations: rows where this user is the direct registrant.
  const { data: individualRegs } = await supabase
    .from("event_registrations")
    .select(
      "id, status, event:events(id, title, event_type, location:locations(timezone), event_sessions(start_time))"
    )
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("registered_at", { ascending: false });

  // Team registrations: this user is a captain, or listed as a member on
  // the team's roster with an account.
  const { data: myTeams } = await supabase
    .from("event_team_members")
    .select("team:event_teams(id, name, event_id)")
    .eq("user_id", user.id);

  const myTeamIds = (myTeams ?? [])
    .map((m) => (Array.isArray(m.team) ? m.team[0] : m.team))
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => t.id);

  const { data: teamRegs } =
    myTeamIds.length > 0
      ? await supabase
          .from("event_registrations")
          .select(
            "id, status, team:event_teams(id, name), event:events(id, title, event_type, location:locations(timezone), event_sessions(start_time))"
          )
          .in("team_id", myTeamIds)
          .neq("status", "cancelled")
          .order("registered_at", { ascending: false })
      : { data: [] };

  const rows = [
    ...(individualRegs ?? []).map((r) => ({
      ...r,
      team: null as { id: string; name: string } | null,
    })),
    ...(teamRegs ?? []).map((r) => ({
      ...r,
      team: Array.isArray(r.team) ? r.team[0] : r.team,
    })),
  ];

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">My Events</h1>

      {cancelled && <SuccessBanner>Registration cancelled.</SuccessBanner>}

      {cancelError && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {cancelError}
        </p>
      )}

      {rows.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">You haven&apos;t registered for any events yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {rows.map((row) => {
          const event = Array.isArray(row.event) ? row.event[0] : row.event;
          if (!event) return null;
          const location = Array.isArray(event.location) ? event.location[0] : event.location;
          const timezone = location?.timezone ?? "UTC";
          const sessions = [...event.event_sessions].sort(
            (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
          );
          const nextSession = sessions[0];

          return (
            <li
              key={row.id}
              className="flex items-center justify-between rounded border border-gray-300 px-4 py-3 dark:border-neutral-800"
            >
              <div>
                <Link href={`/events/${event.id}`} className="font-medium underline">
                  {event.title}
                </Link>
                <p className="text-sm text-gray-600 dark:text-neutral-400">
                  {EVENT_TYPE_LABELS[event.event_type]}
                  {row.team ? ` · Team: ${row.team.name}` : ""}
                </p>
                {nextSession && (
                  <p className="text-sm text-gray-600 dark:text-neutral-400">
                    {formatBookingDate(nextSession.start_time, timezone)} ·{" "}
                    {formatInTimeZone(new Date(nextSession.start_time), timezone, "h:mm a")}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={
                    row.status === "registered"
                      ? "rounded bg-green-50 px-2 py-1 text-xs text-green-800 dark:bg-green-950 dark:text-green-300"
                      : "rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                  }
                >
                  {row.status === "waitlisted" ? "Waitlisted" : "Registered"}
                </span>
                {/* Every row here already belongs to the viewer -- individualRegs is
                    scoped to their own user_id, teamRegs to teams they're a member
                    of via event_team_members -- so Cancel is always actionable.
                    RLS ("event_registrations update own or captain or member")
                    permits any team member, not just a captain, since an
                    admin-assembled team has no captain at all. */}
                <form action={cancelEventRegistration}>
                  <input type="hidden" name="registration_id" value={row.id} />
                  <input type="hidden" name="event_id" value={event.id} />
                  <button type="submit" className="text-xs text-red-700 underline dark:text-red-400">
                    Cancel
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
