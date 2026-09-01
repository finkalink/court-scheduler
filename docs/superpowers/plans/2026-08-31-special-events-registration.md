# Special Events — Registration, Teams & Waitlist (Plan 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players actually register for the events that shipped in
Plan 1 (browse-only). Covers individual sign-up, self-formed team
registration (captain + roster), admin-assembled team formation, capacity
and waitlisting with auto-promotion, and a "My Events" page for players to
see and cancel their own registrations.

**Architecture:** Three new tables (`event_teams`, `event_team_members`,
`event_registrations`) layered on top of Plan 1's `events`/`event_sessions`.
`event_registrations` is the capacity-consuming unit — one row per team
*or* per individual, regardless of team size — matching the shape approved
in the original design spec. Two narrow `security definer` functions
handle the two operations plain RLS can't safely express: promoting the
next waitlisted registration (which updates a *different* player's row
than the one who just cancelled) and looking up an event's individual
registrants' emails for admin team assembly (the `users` table's own RLS
only allows selecting your own row).

**Tech Stack:** Next.js server components/actions, Supabase Postgres + RLS,
Tailwind CSS, Vitest for the one new pure-logic module.

**Spec:** `docs/superpowers/specs/2026-08-30-special-events-design.md`
("Team formation & registration" section) — this plan implements Future
Decomposition item 2. Two deviations from that spec, both resolved during
design review before this plan was written:

1. The spec's prose says a captain lists teammates "by name/email," but
   its own `event_team_members` table only has a `display_name` column, no
   email field. This plan follows the table (name-only rosters) — adding
   an email field would be new scope, not implementing what was approved.
2. The spec's RLS section groups `event_teams`/`event_team_members` under
   "write requires `is_org_member`" alongside `events`/`event_sessions`.
   That's wrong for self-formed team registration: the captain creating
   their own team is a *player*, not necessarily an org member at all.
   This plan's RLS instead allows insert by either the org (admin-assembled
   path) or the team's own captain (self-formed path) — see Task 1.

## Global Constraints

- Every new table gets RLS enabled; `event_teams`/`event_team_members` are
  public-select (`using (true)`, same tier as `events`/`event_sessions` —
  rosters are part of the public tournament picture). `event_registrations`
  is NOT public-select — see the `event_registration_counts` view below for
  why and how capacity is still shown to a non-participant.
- **Capacity checking is app-level (recount, then insert), not a DB
  exclusion constraint.** This deliberately differs from the `bookings`
  table's exclusion-constraint pattern. That pattern exists because a
  double-booked court is a *physical* impossibility this app promises to
  prevent, called out explicitly in `CLAUDE.md` as "critical." Registration
  capacity is a soft business limit — briefly landing one or two over
  capacity under concurrent registration is a minor, correctable business
  event, not a broken invariant. Do not add a DB-level capacity constraint;
  it isn't warranted here and the spec never asked for one.
- No `fee_cents`/payment processing — `payment_status` defaults to
  `'not_required'` and nothing in this plan sets it otherwise. Still out of
  scope (Plan 4).
- No brackets/matches — still out of scope (Plan 3).
- No tests for page components or server actions (this codebase's
  established convention) — only the one pure `src/lib` function is
  unit-tested, test-first.
- No edit/remove-member flow for an already-assembled team's roster —
  admin team assembly is create-once for this plan; reshuffling an
  assembled team is a future enhancement, not asked for here.

---

### Task 1: Migration — registration tables, RLS, and the two security-definer helpers

**Files:**
- Create: `supabase/migrations/0017_event_registration.sql`

**Interfaces:**
- Produces: `event_teams`, `event_team_members`, `event_registrations`
  tables; `public.org_id_for_event(uuid)`;
  `public.promote_next_waitlisted(uuid)` RPC;
  `public.list_event_registrant_emails(uuid)` RPC returning
  `(user_id uuid, email text)` rows; `event_registration_counts` view
  (`event_id, status, count`).

- [ ] **Step 1: Write the migration**

```sql
-- Special events, Plan 2: registration, team formation, waitlisting.
-- Layers on top of events/event_sessions from 0015/0016. Brackets are a
-- separate future migration.

-- Helper: org_id that owns a given event, via its location. Mirrors
-- org_id_for_court/org_id_for_location.
create function public.org_id_for_event(check_event_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select public.org_id_for_location(e.location_id) from events e where e.id = check_event_id;
$$;

create table event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  captain_user_id uuid references users(id), -- null for admin-assembled teams
  created_at timestamptz not null default now()
);

create table event_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references event_teams(id) on delete cascade,
  user_id uuid references users(id), -- null if this teammate has no account
  display_name text not null, -- always present, so a roster can list someone without an account
  created_at timestamptz not null default now()
);

create table event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid references event_teams(id),
  user_id uuid references users(id),
  status text not null default 'registered'
    check (status in ('registered', 'waitlisted', 'cancelled')),
  registered_at timestamptz not null default now(),
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'refunded')),
  check ((team_id is not null) <> (user_id is not null)) -- exactly one, same XOR convention as blocked_slots
);

-- A player can only have one active (registered/waitlisted) individual
-- registration per event at a time. Re-registering after cancelling is
-- fine -- this only blocks a simultaneous second active one.
create unique index event_registrations_active_user_unique
  on event_registrations (event_id, user_id)
  where user_id is not null and status <> 'cancelled';

alter table event_teams enable row level security;
alter table event_team_members enable row level security;
alter table event_registrations enable row level security;

-- event_teams / event_team_members: public read, same tier as
-- events/event_sessions. Insert allowed by an org member (admin-assembled
-- path) OR by the team's own captain (self-formed path -- a player, not
-- necessarily an org member).
create policy "event_teams select all" on event_teams
  for select using (true);
create policy "event_teams insert member or captain" on event_teams
  for insert with check (
    public.is_org_member(public.org_id_for_event(event_id))
    or captain_user_id = auth.uid()
  );

create policy "event_team_members select all" on event_team_members
  for select using (true);
create policy "event_team_members insert member or captain" on event_team_members
  for insert with check (
    exists (
      select 1 from event_teams t
      where t.id = team_id
        and (t.captain_user_id = auth.uid() or public.is_org_member(public.org_id_for_event(t.event_id)))
    )
  );

-- event_registrations: NOT public-select -- a registration row identifies
-- who registered, unlike a team roster. A registrant (individual, or via
-- team membership) sees and manages their own; a team's captain manages
-- their team's; an org member sees/manages anything for their own event
-- (admin-assembled team creation, cleanup).
create policy "event_registrations select own or member" on event_registrations
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from event_team_members m
      where m.team_id = event_registrations.team_id and m.user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  );
create policy "event_registrations insert own or captain or member" on event_registrations
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from event_teams t
      where t.id = team_id and t.captain_user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  );
create policy "event_registrations update own or captain or member" on event_registrations
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from event_teams t
      where t.id = event_registrations.team_id and t.captain_user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  );
create policy "event_registrations delete member" on event_registrations
  for delete using (public.is_org_member(public.org_id_for_event(event_id)));

-- event_registration_counts: exposes only event_id/status/count, no
-- identity -- same privacy-preserving pattern as the booked_slots view
-- (0002_rls.sql), which exists for exactly the same reason: a plain
-- player has no RLS visibility into other players' registration rows, but
-- still needs to know "is this event full" to decide whether to register
-- or join the waitlist.
create view event_registration_counts
with (security_invoker = false)
as
  select event_id, status, count(*) as count
  from event_registrations
  group by event_id, status;

grant select on event_registration_counts to authenticated;

-- Waitlist promotion updates a DIFFERENT player's registration row than
-- the one who just cancelled -- no plain RLS policy expresses that
-- safely. Narrow security-definer function: only ever promotes the single
-- oldest waitlisted row for one event, and only when a real slot is free
-- (recomputed here, never trusted from the caller).
create function public.promote_next_waitlisted(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_registered_count integer;
  v_next_id uuid;
begin
  select capacity into v_capacity from events where id = p_event_id;
  if v_capacity is null then
    return; -- unlimited capacity, no waitlist concept
  end if;

  select count(*) into v_registered_count
  from event_registrations
  where event_id = p_event_id and status = 'registered';

  if v_registered_count >= v_capacity then
    return; -- still full, nothing to promote
  end if;

  select id into v_next_id
  from event_registrations
  where event_id = p_event_id and status = 'waitlisted'
  order by registered_at asc
  limit 1;

  if v_next_id is not null then
    update event_registrations set status = 'registered' where id = v_next_id;
  end if;
end;
$$;

grant execute on function public.promote_next_waitlisted(uuid) to authenticated;

-- Admin-assembled team creation needs each selected registrant's email --
-- the users table's own RLS only allows selecting your own row. Same
-- narrow, caller-authorized pattern as list_org_member_emails
-- (0011_org_member_emails.sql): only returns rows for players
-- individually registered for an event the CALLER is an org member of.
create function public.list_event_registrant_emails(check_event_id uuid)
returns table(user_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.email
  from event_registrations r
  join users u on u.id = r.user_id
  where r.event_id = check_event_id
    and r.user_id is not null
    and r.status = 'registered'
    and public.is_org_member(public.org_id_for_event(check_event_id));
$$;

grant execute on function public.list_event_registrant_emails(uuid) to authenticated;

create index event_teams_event_idx on event_teams (event_id);
create index event_team_members_team_idx on event_team_members (team_id);
create index event_registrations_event_idx on event_registrations (event_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0017_event_registration.sql`

- [ ] **Step 3: Verify against the live database**

Using the same direct-`pg` verification pattern as prior migrations,
confirm: all three tables and their columns exist; the partial unique
index rejects a second simultaneous active individual registration for
the same event but allows re-registering after a cancel; `promote_next_waitlisted`
run against a seeded event with one 'registered' and one 'waitlisted' row
at capacity 1 does nothing (still full), but after manually cancelling the
'registered' row, calling it again promotes the waitlisted one;
`list_event_registrant_emails` returns rows only when called as (or
`security definer`-emulated for) an actual org member of that event's org,
not for an arbitrary caller; `event_registration_counts` returns the right
per-status counts for a seeded event.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0017_event_registration.sql
git commit -m "Add event registration/team/waitlist tables and RLS"
```

---

### Task 2: Pure logic — registration status decision

**Files:**
- Create: `src/lib/eventRegistration.ts`
- Create: `src/lib/eventRegistration.test.ts`

**Interfaces:**
- Produces: `determineRegistrationStatus(currentRegisteredCount, capacity)`
  (consumed by Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/eventRegistration.test.ts
import { describe, expect, it } from "vitest";
import { determineRegistrationStatus } from "@/lib/eventRegistration";

describe("determineRegistrationStatus", () => {
  it("registers when capacity is unlimited (null)", () => {
    expect(determineRegistrationStatus(0, null)).toBe("registered");
    expect(determineRegistrationStatus(1000, null)).toBe("registered");
  });

  it("registers when under capacity", () => {
    expect(determineRegistrationStatus(3, 8)).toBe("registered");
  });

  it("registers on the last available spot", () => {
    expect(determineRegistrationStatus(7, 8)).toBe("registered");
  });

  it("waitlists once capacity is reached", () => {
    expect(determineRegistrationStatus(8, 8)).toBe("waitlisted");
  });

  it("waitlists when already over capacity", () => {
    expect(determineRegistrationStatus(10, 8)).toBe("waitlisted");
  });

  it("waitlists immediately when capacity is zero", () => {
    expect(determineRegistrationStatus(0, 0)).toBe("waitlisted");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- eventRegistration`
Expected: FAIL with "Cannot find module '@/lib/eventRegistration'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/eventRegistration.ts
export function determineRegistrationStatus(
  currentRegisteredCount: number,
  capacity: number | null
): "registered" | "waitlisted" {
  if (capacity === null) return "registered";
  return currentRegisteredCount < capacity ? "registered" : "waitlisted";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- eventRegistration`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventRegistration.ts src/lib/eventRegistration.test.ts
git commit -m "Add registration-status decision logic, test-first"
```

---

### Task 3: Player registration/cancellation actions

**Files:**
- Create: `src/app/actions/events.ts`

**Interfaces:**
- Consumes: `determineRegistrationStatus` from Task 2.
- Produces: `registerForEvent(formData)`, `cancelEventRegistration(formData)`
  (consumed by Tasks 4, 5).

- [ ] **Step 1: Write the actions file**

```ts
// src/app/actions/events.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { determineRegistrationStatus } from "@/lib/eventRegistration";

const UNIQUE_VIOLATION = "23505";

export async function registerForEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const teammateNames = formData
    .getAll("teammate_name")
    .map((n) => String(n).trim())
    .filter(Boolean);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
  }

  const { data: event } = await supabase
    .from("events")
    .select("capacity, registration_mode, team_formation")
    .eq("id", eventId)
    .single();

  if (!event) {
    throw new Error("Event not found.");
  }

  let teamId: string | null = null;

  // Self-formed team registration: create the team + roster now. Every
  // other case (individual events, and admin-assembled team events) is a
  // plain individual sign-up -- the org builds teams later for the
  // admin-assembled case.
  if (event.registration_mode === "team" && event.team_formation === "self_formed" && teamName) {
    const { data: team, error: teamError } = await supabase
      .from("event_teams")
      .insert({ event_id: eventId, name: teamName, captain_user_id: user.id })
      .select("id")
      .single();

    if (teamError) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent(teamError.message)}`);
    }

    teamId = team.id;

    await supabase
      .from("event_team_members")
      .insert({ team_id: teamId, user_id: user.id, display_name: user.email ?? "Captain" });

    for (const name of teammateNames) {
      await supabase.from("event_team_members").insert({ team_id: teamId, display_name: name });
    }
  }

  const { count: registeredCount } = await supabase
    .from("event_registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "registered");

  const status = determineRegistrationStatus(registeredCount ?? 0, event.capacity);

  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
  });

  if (error) {
    const message =
      error.code === UNIQUE_VIOLATION
        ? "You're already registered for this event."
        : error.message;
    redirect(`/events/${eventId}?register_error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect(`/events/${eventId}?registered=1`);
}

// Shared by the "My Events" page. RLS ("event_registrations update own or
// captain or member") is what actually decides whether this caller is
// allowed to cancel this particular registration.
export async function cancelEventRegistration(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ status: "cancelled" })
    .eq("id", registrationId);

  if (error) {
    throw new Error(error.message);
  }

  // A freed 'registered' spot should immediately pull the next waitlisted
  // registrant up -- this needs to update a DIFFERENT player's row than
  // the one who just cancelled, which is why this is a security-definer
  // RPC rather than a plain client update (see the migration).
  await supabase.rpc("promote_next_waitlisted", { p_event_id: eventId });

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect("/events/registrations?cancelled=1");
}
```

- [ ] **Step 2: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same count as before plus Task 2's new tests

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "Add player event registration and cancellation actions"
```

---

### Task 4: Player — Register section on the event detail page

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `registerForEvent` from Task 3.

- [ ] **Step 1: Add the registration status/capacity queries and the Register section**

The current page (`src/app/events/[eventId]/page.tsx`) ends its data
fetching after the `events` query. Add, right after that query and before
the `location`/`org` destructuring:

```tsx
import { registerForEvent } from "@/app/actions/events";
```

```tsx
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let myIndividualRegistration: { id: string; status: string } | null = null;
  let myCaptainTeam: { id: string; name: string } | null = null;
  let registeredCount = 0;

  if (user) {
    const { data: individualReg } = await supabase
      .from("event_registrations")
      .select("id, status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .neq("status", "cancelled")
      .maybeSingle();
    myIndividualRegistration = individualReg;

    const { data: captainTeam } = await supabase
      .from("event_teams")
      .select("id, name")
      .eq("event_id", eventId)
      .eq("captain_user_id", user.id)
      .maybeSingle();
    myCaptainTeam = captainTeam;

    const { data: counts } = await supabase
      .from("event_registration_counts")
      .select("status, count")
      .eq("event_id", eventId);
    registeredCount = (counts ?? []).find((c) => c.status === "registered")?.count ?? 0;
  }

  const isFull = event.capacity != null && registeredCount >= event.capacity;
  const alreadyRegistered = Boolean(myIndividualRegistration || myCaptainTeam);
```

Then add a new section, right after the existing "Capacity: {event.capacity}"
paragraph and cancelled-notice block, before the "Sessions" `<h2>`:

```tsx
      {event.status !== "cancelled" && (
        <>
          {alreadyRegistered ? (
            <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
              {myCaptainTeam
                ? `Your team, ${myCaptainTeam.name}, is registered.`
                : myIndividualRegistration?.status === "waitlisted"
                  ? "You're on the waitlist."
                  : "You're registered."}
            </p>
          ) : (
            <div className="mt-4">
              {registerError && (
                <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
                  {registerError}
                </p>
              )}
              {registered && (
                <p className="mb-3 rounded bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
                  {isFull ? "You're on the waitlist." : "You're registered."}
                </p>
              )}
              {event.registration_mode === "team" && event.team_formation === "self_formed" ? (
                <form action={registerForEvent} className="flex flex-col gap-3">
                  <input type="hidden" name="event_id" value={event.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Team name
                    <input name="team_name" required className="rounded border px-3 py-2" />
                  </label>
                  <p className="text-xs text-gray-600 dark:text-neutral-400">Teammates (optional)</p>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <input
                      key={n}
                      name="teammate_name"
                      placeholder={`Teammate ${n}`}
                      className="rounded border px-3 py-2 text-sm"
                    />
                  ))}
                  <button
                    type="submit"
                    className="w-fit rounded bg-black px-4 py-2 text-sm text-white"
                  >
                    {isFull ? "Join Waitlist" : "Register Team"}
                  </button>
                </form>
              ) : (
                <form action={registerForEvent}>
                  <input type="hidden" name="event_id" value={event.id} />
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
```

Update the component's `searchParams` prop to accept the two new query
params and destructure them at the top of the function:

```tsx
export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ registered?: string; register_error?: string }>;
}) {
  const { eventId } = await params;
  const { registered, register_error: registerError } = await searchParams;
```

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/events/[eventId]/page.tsx
git commit -m "Add event registration UI to the player event detail page"
```

---

### Task 5: Player — "My Events" page and nav item

**Files:**
- Create: `src/app/events/registrations/page.tsx`
- Modify: `src/components/AppShell.tsx` (add "My Events" nav item)

**Interfaces:**
- Consumes: `cancelEventRegistration` from Task 3.

- [ ] **Step 1: Write the page**

```tsx
// src/app/events/registrations/page.tsx
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
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { cancelled } = await searchParams;
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
    .select("team:event_teams(id, name, event_id, captain_user_id)")
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
    ...(individualRegs ?? []).map((r) => ({ ...r, team: null as { id: string; name: string } | null })),
    ...(teamRegs ?? []).map((r) => ({
      ...r,
      team: Array.isArray(r.team) ? r.team[0] : r.team,
    })),
  ];

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">My Events</h1>

      {cancelled && <SuccessBanner>Registration cancelled.</SuccessBanner>}

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
```

- [ ] **Step 2: Add the sidebar nav item**

In `src/components/AppShell.tsx`, add a new active-state check alongside
the existing ones:

```tsx
  const myEventsActive = pathname.startsWith("/events/registrations");
```

`eventsActive` (`pathname.startsWith("/events")`) already matches
`/events/registrations` too — narrow it so the two nav items don't both
highlight at once:

```tsx
  const eventsActive = pathname.startsWith("/events") && !myEventsActive;
```

Add the link in the `<nav>`, immediately after "My Bookings" (inside the
existing `{userEmail && (...)}` block, since — like "My Bookings" — this
only makes sense for a signed-in user):

```tsx
          {userEmail && (
            <Link
              href="/bookings"
              className={linkClass(bookingsActive)}
              onClick={() => setOpen(false)}
            >
              My Bookings
            </Link>
          )}
          {userEmail && (
            <Link
              href="/events/registrations"
              className={linkClass(myEventsActive)}
              onClick={() => setOpen(false)}
            >
              My Events
            </Link>
          )}
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/events/registrations/page.tsx src/components/AppShell.tsx
git commit -m "Add My Events page and nav item"
```

---

### Task 6: Admin — assemble teams from individual registrants

**Files:**
- Create: `src/app/admin/eventTeamActions.ts`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`

**Interfaces:**
- Produces: `assembleEventTeam(formData)`.
- Consumes: nothing new from earlier tasks in this plan (reads
  `event_registrations`/`event_teams`/`list_event_registrant_emails`
  directly).

- [ ] **Step 1: Write the action**

```ts
// src/app/admin/eventTeamActions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function assembleEventTeam(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const registrationIds = formData.getAll("registration_id").map(String);

  const supabase = await createClient();

  if (!teamName || registrationIds.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?assemble_error=${encodeURIComponent("Pick a team name and at least one registrant.")}`
    );
  }

  const { data: emailRows, error: emailError } = await supabase.rpc(
    "list_event_registrant_emails",
    { check_event_id: eventId }
  );
  if (emailError) {
    throw new Error(emailError.message);
  }
  const emailByUserId = new Map((emailRows ?? []).map((r) => [r.user_id, r.email]));

  const { data: registrations, error: regError } = await supabase
    .from("event_registrations")
    .select("id, user_id")
    .in("id", registrationIds);
  if (regError) {
    throw new Error(regError.message);
  }

  const { data: team, error: teamError } = await supabase
    .from("event_teams")
    .insert({ event_id: eventId, name: teamName })
    .select("id")
    .single();
  if (teamError) {
    throw new Error(teamError.message);
  }

  for (const reg of registrations ?? []) {
    const displayName = (reg.user_id && emailByUserId.get(reg.user_id)) || "Player";
    await supabase
      .from("event_team_members")
      .insert({ team_id: team.id, user_id: reg.user_id, display_name: displayName });
  }

  // The individual registrations are consumed into the new team-level
  // registration -- delete the per-player rows, insert one row for the team.
  await supabase.from("event_registrations").delete().in("id", registrationIds);
  const { error: insertError } = await supabase
    .from("event_registrations")
    .insert({ event_id: eventId, team_id: team.id, status: "registered" });
  if (insertError) {
    throw new Error(insertError.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?team_assembled=1`);
}
```

- [ ] **Step 2: Add the assembly section to the admin event page**

In `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`, add
the import:

```tsx
import { assembleEventTeam } from "@/app/admin/eventTeamActions";
```

Add `team_assembled` and `assemble_error` to the `searchParams` type and
destructuring, alongside the existing params.

After the `event` query, fetch the ungrouped individual registrants —
only relevant when the event is an admin-assembled team event:

```tsx
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
  const emailByUserId = new Map((registrantEmails ?? []).map((r) => [r.user_id, r.email]));
```

Add a new section, right after the "Sessions" section's closing `</ul>`
and before the `addEventSession` form (or after it — either position is
fine; place it as its own clearly-labeled block):

```tsx
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
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/eventTeamActions.ts "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx"
git commit -m "Add admin team assembly for admin-assembled events"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers schema-level checks).
- **Individual event:** as a signed-in player, register for the Beach Bash
  Open (individual) seed event, confirm it shows on `/events/registrations`,
  cancel it, confirm it disappears (soft-deleted, not shown) and the
  capacity count on the detail page drops.
- **Self-formed team event:** register a team (with 2-3 named teammates)
  for the Winter Classic seed event as the captain; confirm the event
  detail page shows "Your team, X, is registered," `/events/registrations`
  shows it with the team name, and a second attempt to register for the
  same event (as the same user) is blocked.
- **Admin-assembled team event:** as two different signed-in players,
  individually register for the Spring Draft Tournament seed event (after
  first publishing it, since it's currently `draft`); as the org owner, use
  the new "Assemble Teams" section to group both into one team; confirm
  the two individual registrations disappear and are replaced by one
  team-level registration, and that both players now see "Your team is
  registered" (via team membership) rather than their old individual
  status on `/events/registrations`.
- **Waitlist:** set an event's capacity to 1 via the admin edit form,
  register two different players (first gets 'registered', second gets
  'waitlisted' — confirm via the UI badges), cancel the first player's
  registration, confirm the second is automatically promoted to
  'registered' (both via a page reload and by checking their own
  `/events/registrations` status).
- Confirm a staff-role account (not owner/admin) can use the "Assemble
  Teams" admin section, matching the existing capability split.
- Confirm a signed-out visitor clicking "Register" is redirected to
  `/login?next=/events/{id}` and lands back on the event page after
  signing in.
