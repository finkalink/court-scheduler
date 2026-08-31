# Special Events — Core (Plan 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each location a way to host events (tournaments, leagues,
open play, clinics) as a first-class concept: create an event, schedule
one or more sessions (court + time), and let players browse and view
events across the existing City → Club → Location hierarchy. No
registration, teams, or brackets yet — those are Plans 2 and 3.

**Architecture:** New `events`/`event_sessions` tables. An event session
reserves real court time by also inserting a row into the existing
`bookings` table (new `source`/`event_session_id` columns), so the
already-existing GIST exclusion constraint — the one thing in this codebase
explicitly called out as "critical, do not rely on app-level checks alone"
— is what prevents an event from double-booking a court, and prevents a
player from booking over an event, with zero new conflict-checking logic.

**Tech Stack:** Next.js server components/actions, Supabase Postgres + RLS,
Tailwind CSS, Vitest for the one new pure-logic module.

**Spec:** `docs/superpowers/specs/2026-08-30-special-events-design.md` — this
plan implements only the "Future Decomposition" item 1 ("Core events +
sessions + court-blocking") from that spec. Items 2-4 (registration/teams,
brackets, payment integration) are separate future plans.

## Global Constraints

- Every new table gets RLS enabled from day one; select policy is
  `using (true)` (public read, matching the established pattern for
  facility/schedule data — `blocked_slots`, `availability_rules`, etc. —
  learning from the earlier gap where some tables started
  `authenticated`-only and had to be fixed later).
- Write access to `events`/`event_sessions` requires `is_org_member` for
  the owning org (staff included) — same tier as
  `availability_rules`/`slot_overrides`/`blocked_slots`, not
  owner/admin-only.
- `events` has no direct `org_id` column — matches how `courts` derives its
  org via `location_id`, not a redundant stored column. A new
  `org_id_for_location` SQL helper mirrors the existing
  `org_id_for_court`.
- Court-time blocking MUST go through the existing `bookings` table and its
  exclusion constraint — do not add a second, parallel conflict-checking
  mechanism.
- `computeOpenSlots` and the `booked_slots` view need NO changes — both
  already key off `bookings.status = 'confirmed'`, which an event session's
  paired booking row also has by default.
- No tests for page components or server actions — matches this
  codebase's existing convention (only pure `src/lib` functions are
  unit-tested, test-first). Verify pages manually in the browser.
- `fee_cents`/`payment_status`-shaped fields are NOT part of this plan's
  schema — `events.fee_cents` doesn't exist yet; it's added in the future
  Plan 4 (payment integration) alongside the rest of registration. Nothing
  in this plan references payment.
- Draft events (`status = 'draft'`) are excluded from every player-facing
  query (`.neq("status", "draft")`) — they're readable by RLS (public
  select) but the app layer keeps them admin-only-visible until published.

---

### Task 1: Migration — events, event_sessions, bookings court-blocking

**Files:**
- Create: `supabase/migrations/0015_events_core.sql`

**Interfaces:**
- Produces: `events` table (`id, location_id, event_type, title,
  description, registration_mode, team_formation, capacity,
  registration_opens_at, registration_closes_at, status, created_at`),
  `event_sessions` table (`id, event_id, court_id, start_time, end_time,
  label`), `bookings.source` (`'player' | 'event'`),
  `bookings.event_session_id`, `public.org_id_for_location(uuid)`.

- [ ] **Step 1: Write the migration**

```sql
-- Special events: tournaments, leagues, open play, clinics. This is the
-- core migration -- events, sessions, and court-time blocking. Team
-- registration, brackets, and payment are later migrations layered on top.

-- Helper: org_id that owns a given location -- mirrors org_id_for_court.
-- events has no direct org_id column, same reasoning as courts: derive it
-- via location_id rather than storing a value that could drift.
create function public.org_id_for_location(check_location_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from locations where id = check_location_id;
$$;

create table events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  event_type text not null check (event_type in ('tournament', 'league', 'open_play', 'clinic')),
  title text not null,
  description text,
  registration_mode text not null check (registration_mode in ('team', 'individual')),
  -- only meaningful when registration_mode = 'team'; null for individual events
  team_formation text check (team_formation in ('self_formed', 'admin_assembled')),
  capacity integer, -- max registered units once registration exists (Plan 2); null = unlimited
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  check ((registration_mode = 'team') = (team_formation is not null))
);

create table event_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  court_id uuid not null references courts(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  label text, -- "Week 3", "Round 1"; null for a single-session event
  check (start_time < end_time)
);

-- Court-blocking: an event session also creates a row in the existing
-- bookings table, so the table's own exclusion constraint (see 0001_init.sql)
-- -- the thing that already makes double-booking impossible -- governs event
-- time too. A player can't book over an event, and two events can't
-- double-book the same court, with no new conflict-checking logic.
alter table bookings add column source text not null default 'player' check (source in ('player', 'event'));
alter table bookings add column event_session_id uuid references event_sessions(id) on delete cascade;
alter table bookings alter column user_id drop not null;
alter table bookings add constraint bookings_source_shape check (
  (source = 'player' and user_id is not null and event_session_id is null) or
  (source = 'event' and user_id is null and event_session_id is not null)
);

alter table events enable row level security;
alter table event_sessions enable row level security;

-- events/event_sessions: public read (non-sensitive schedule data, same as
-- courts/availability_rules/blocked_slots), write requires org membership
-- (staff included -- day-to-day scheduling, not owner/admin-gated).
create policy "events select all" on events
  for select using (true);
create policy "events write member" on events
  for insert with check (public.is_org_member(public.org_id_for_location(location_id)));
create policy "events update member" on events
  for update using (public.is_org_member(public.org_id_for_location(location_id)));
create policy "events delete member" on events
  for delete using (public.is_org_member(public.org_id_for_location(location_id)));

create policy "event_sessions select all" on event_sessions
  for select using (true);
create policy "event_sessions write member" on event_sessions
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "event_sessions delete member" on event_sessions
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));
-- No update policy: a session's time/court is changed by removing it and
-- adding a new one (mirrors how blocked_slots has no update policy either
-- -- toggling is insert-or-delete, not an in-place edit).

create index events_location_idx on events (location_id);
create index event_sessions_event_idx on event_sessions (event_id);
create index event_sessions_court_start_idx on event_sessions (court_id, start_time);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0015_events_core.sql`

- [ ] **Step 3: Verify against the live database**

Connect via the same `pg`-based script pattern used for prior migrations
(or a one-off `node -e` using `DATABASE_URL`) and confirm: `events` and
`event_sessions` exist with the expected columns; `bookings` has the new
`source`/`event_session_id` columns and `user_id` is now nullable;
inserting a `bookings` row with `source = 'event'` and `user_id` set (or
`source = 'player'` and `event_session_id` set) is rejected by
`bookings_source_shape`; the existing exclusion constraint still rejects
an overlapping `source = 'event'` insert against an existing confirmed
booking on the same court (same `23P01` mechanism as today).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_events_core.sql
git commit -m "Add events/event_sessions tables and event court-blocking via bookings"
```

---

### Task 2: Pure logic — event sorting/grouping and type labels

**Files:**
- Create: `src/lib/eventGrouping.ts`
- Create: `src/lib/eventGrouping.test.ts`
- Create: `src/lib/eventTypes.ts`

**Interfaces:**
- Produces: `nextUpcomingSession`, `sortBySoonestSession`,
  `groupEventsByCity` (consumed by Tasks 5, 6, 7), `EVENT_TYPE_LABELS`
  (consumed by Tasks 3, 4, 5, 6).
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/eventGrouping.test.ts
import { describe, expect, it } from "vitest";
import { nextUpcomingSession, sortBySoonestSession, groupEventsByCity } from "@/lib/eventGrouping";

const NOW = new Date("2026-09-01T00:00:00Z");

describe("nextUpcomingSession", () => {
  it("returns null for no sessions", () => {
    expect(nextUpcomingSession([], NOW)).toBeNull();
  });

  it("returns null when every session is in the past", () => {
    const sessions = [{ start_time: "2026-08-01T00:00:00Z" }];
    expect(nextUpcomingSession(sessions, NOW)).toBeNull();
  });

  it("picks the earliest of several upcoming sessions", () => {
    const sessions = [
      { start_time: "2026-09-10T00:00:00Z" },
      { start_time: "2026-09-05T00:00:00Z" },
      { start_time: "2026-09-20T00:00:00Z" },
    ];
    expect(nextUpcomingSession(sessions, NOW)).toEqual({ start_time: "2026-09-05T00:00:00Z" });
  });

  it("ignores past sessions mixed in with future ones", () => {
    const sessions = [
      { start_time: "2026-08-01T00:00:00Z" },
      { start_time: "2026-09-15T00:00:00Z" },
    ];
    expect(nextUpcomingSession(sessions, NOW)).toEqual({ start_time: "2026-09-15T00:00:00Z" });
  });
});

describe("sortBySoonestSession", () => {
  it("drops events with no upcoming sessions", () => {
    const events = [
      { id: "past", sessions: [{ start_time: "2026-01-01T00:00:00Z" }] },
      { id: "future", sessions: [{ start_time: "2026-09-10T00:00:00Z" }] },
    ];
    expect(sortBySoonestSession(events, NOW).map((e) => e.id)).toEqual(["future"]);
  });

  it("sorts remaining events by their soonest session", () => {
    const events = [
      { id: "later", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "sooner", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
    ];
    expect(sortBySoonestSession(events, NOW).map((e) => e.id)).toEqual(["sooner", "later"]);
  });
});

describe("groupEventsByCity", () => {
  it("returns empty groups for no events", () => {
    expect(groupEventsByCity([], NOW)).toEqual({ cities: [], otherEvents: [] });
  });

  it("buckets events by city, sorted soonest-first within a city", () => {
    const events = [
      { id: "ny-later", city: "New York", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "ny-sooner", city: "New York", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
      { id: "la-only", city: "Los Angeles", sessions: [{ start_time: "2026-09-15T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    const ny = result.cities.find((c) => c.city === "New York");
    expect(ny?.events.map((e) => e.id)).toEqual(["ny-sooner", "ny-later"]);
  });

  it("sorts cities by their own soonest event", () => {
    const events = [
      { id: "ny", city: "New York", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "la", city: "Los Angeles", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities.map((c) => c.city)).toEqual(["Los Angeles", "New York"]);
  });

  it("routes events with no city to otherEvents, excluded from cities", () => {
    const events = [
      { id: "has-city", city: "New York", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
      { id: "no-city", city: null, sessions: [{ start_time: "2026-09-10T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities.map((c) => c.city)).toEqual(["New York"]);
    expect(result.otherEvents.map((e) => e.id)).toEqual(["no-city"]);
  });

  it("drops events with no upcoming sessions entirely, even from otherEvents", () => {
    const events = [{ id: "past", city: null, sessions: [{ start_time: "2026-01-01T00:00:00Z" }] }];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities).toEqual([]);
    expect(result.otherEvents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- eventGrouping`
Expected: FAIL with "Cannot find module '@/lib/eventGrouping'" (or similar)

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/eventGrouping.ts
export interface EventSessionSummary {
  start_time: string; // ISO instant
}

// The soonest session that hasn't started yet, or null if every session is
// already in the past (or there are none at all).
export function nextUpcomingSession<T extends EventSessionSummary>(
  sessions: T[],
  now: Date
): T | null {
  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now);
  if (upcoming.length === 0) return null;
  return upcoming.reduce((soonest, s) =>
    new Date(s.start_time) < new Date(soonest.start_time) ? s : soonest
  );
}

// Events with at least one upcoming session, sorted soonest-first. Events
// with no upcoming sessions (fully in the past, or none scheduled) are
// dropped -- matches how the player booking calendar doesn't surface past
// dates by default.
export function sortBySoonestSession<T extends { sessions: EventSessionSummary[] }>(
  events: T[],
  now: Date
): T[] {
  return events
    .map((event) => ({ event, next: nextUpcomingSession(event.sessions, now) }))
    .filter((e): e is { event: T; next: EventSessionSummary } => e.next !== null)
    .sort((a, b) => new Date(a.next.start_time).getTime() - new Date(b.next.start_time).getTime())
    .map((e) => e.event);
}

export interface CityEventGroup<T> {
  city: string;
  events: T[]; // sorted soonest-first
}

export interface GroupedEventsByCity<T> {
  cities: CityEventGroup<T>[]; // sorted by each city's own soonest event
  otherEvents: T[]; // events at locations with no city set, sorted soonest-first
}

// For the events browse page: mirrors groupLocationsByCity's shape, but
// grouping is over events (not distinct clubs) and ordering is
// time-driven (soonest first), not alphabetical.
export function groupEventsByCity<T extends { city: string | null; sessions: EventSessionSummary[] }>(
  events: T[],
  now: Date
): GroupedEventsByCity<T> {
  const upcoming = sortBySoonestSession(events, now);

  const otherEvents: T[] = [];
  const byCity = new Map<string, T[]>();

  for (const event of upcoming) {
    if (!event.city) {
      otherEvents.push(event);
      continue;
    }
    const list = byCity.get(event.city) ?? [];
    list.push(event);
    byCity.set(event.city, list);
  }

  const cities: CityEventGroup<T>[] = Array.from(byCity.entries())
    .map(([city, cityEvents]) => ({ city, events: cityEvents }))
    .sort((a, b) => {
      const aNext = nextUpcomingSession(a.events[0].sessions, now)!;
      const bNext = nextUpcomingSession(b.events[0].sessions, now)!;
      return new Date(aNext.start_time).getTime() - new Date(bNext.start_time).getTime();
    });

  return { cities, otherEvents };
}
```

```ts
// src/lib/eventTypes.ts
export const EVENT_TYPE_LABELS: Record<string, string> = {
  tournament: "Tournament",
  league: "League",
  open_play: "Open Play",
  clinic: "Clinic",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- eventGrouping`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventGrouping.ts src/lib/eventGrouping.test.ts src/lib/eventTypes.ts
git commit -m "Add event sorting/grouping pure logic, test-first"
```

---

### Task 3: Admin — event actions, list/create page

**Files:**
- Create: `src/app/admin/eventActions.ts`
- Create: `src/app/admin/locations/[locationId]/events/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/page.tsx` (add an
  "Events →" link, same pattern as the existing "General Hours →" link)

**Interfaces:**
- Consumes: `EVENT_TYPE_LABELS` from Task 2.
- Produces: `createEvent(formData)` server action (consumed by this
  task's own page); the `/admin/locations/[locationId]/events` route
  (linked from Task 4's manage page).

- [ ] **Step 1: Write the actions file**

```ts
// src/app/admin/eventActions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

function eventFieldsFromFormData(formData: FormData) {
  const registrationMode = String(formData.get("registration_mode") || "individual");
  const teamFormationInput = String(formData.get("team_formation") || "");
  const capacity = String(formData.get("capacity") || "");

  return {
    event_type: String(formData.get("event_type") || "tournament"),
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || "") || null,
    registration_mode: registrationMode,
    team_formation: registrationMode === "team" ? teamFormationInput || "self_formed" : null,
    capacity: capacity ? Number(capacity) : null,
    status: String(formData.get("status") || "draft"),
  };
}

export async function createEvent(formData: FormData) {
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .insert({ location_id: locationId, ...eventFieldsFromFormData(formData) })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events`);
  redirect(`/admin/locations/${locationId}/events/${event.id}?event_added=1`);
}

export async function updateEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update(eventFieldsFromFormData(formData))
    .eq("id", eventId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?event_saved=1`);
}

// start_time/end_time arrive as datetime-local strings (no timezone info,
// e.g. "2026-09-12T09:00") from Task 4's form -- fromZonedTime converts
// that wall-clock string to a real UTC instant using the location's own
// timezone, the write-side counterpart to formatInTimeZone already used
// for display elsewhere in this codebase.
export async function addEventSession(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const courtId = String(formData.get("court_id"));
  const label = String(formData.get("label") || "") || null;

  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("timezone")
    .eq("id", locationId)
    .single();
  const timezone = location?.timezone ?? "UTC";

  const startTime = fromZonedTime(String(formData.get("start_time")), timezone).toISOString();
  const endTime = fromZonedTime(String(formData.get("end_time")), timezone).toISOString();

  const { data: session, error: sessionError } = await supabase
    .from("event_sessions")
    .insert({ event_id: eventId, court_id: courtId, start_time: startTime, end_time: endTime, label })
    .select("id")
    .single();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const { error: bookingError } = await supabase.from("bookings").insert({
    court_id: courtId,
    source: "event",
    event_session_id: session.id,
    start_time: startTime,
    end_time: endTime,
  });

  if (bookingError) {
    // Roll back the orphaned session row -- the booking is what actually
    // reserves the court, so a session without one is meaningless.
    await supabase.from("event_sessions").delete().eq("id", session.id);
    const message =
      bookingError.code === EXCLUSION_VIOLATION
        ? "That court is already booked or blocked at that time."
        : bookingError.message;
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?session_error=${encodeURIComponent(message)}`
    );
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_added=1`);
}

export async function removeEventSession(formData: FormData) {
  const sessionId = String(formData.get("session_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  // Deleting the session cascades to its paired bookings row
  // (bookings.event_session_id references event_sessions on delete cascade),
  // freeing the court time in one step.
  const { error } = await supabase.from("event_sessions").delete().eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?session_removed=1`);
}
```

- [ ] **Step 2: Write the list/create page**

```tsx
// src/app/admin/locations/[locationId]/events/page.tsx
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
```

Note: registration/capacity/status fields are collected now even though
nothing reads `registration_mode`/`team_formation`/`capacity` yet outside
this form — they're real columns on `events` already, so collecting them
now avoids a second form-editing pass when Plan 2 (registration) needs
them.

- [ ] **Step 3: Add the "Events →" link on the location's admin page**

In `src/app/admin/locations/[locationId]/page.tsx`, immediately after the
existing "General Hours →" link:

```tsx
      <Link href={`/admin/locations/${locationId}/hours`} className="mt-2 block w-fit text-sm underline">
        General Hours &rarr;
      </Link>

      <Link href={`/admin/locations/${locationId}/events`} className="mt-2 block w-fit text-sm underline">
        Events &rarr;
      </Link>
```

- [ ] **Step 4: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same count as before plus Task 2's new tests

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/eventActions.ts src/app/admin/locations/[locationId]/events/page.tsx src/app/admin/locations/[locationId]/page.tsx
git commit -m "Add admin event creation and per-location events list"
```

---

### Task 4: Admin — event detail/manage page (edit + sessions)

**Files:**
- Create: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `updateEvent`, `addEventSession`, `removeEventSession` from
  Task 3; `EVENT_TYPE_LABELS` from Task 2.

- [ ] **Step 1: Write the page**

```tsx
// src/app/admin/locations/[locationId]/events/[eventId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { updateEvent, addEventSession, removeEventSession } from "@/app/admin/eventActions";
import SuccessBanner from "@/components/SuccessBanner";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function AdminEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; eventId: string }>;
  searchParams: Promise<{
    event_saved?: string;
    session_added?: string;
    session_removed?: string;
    session_error?: string;
  }>;
}) {
  const { locationId, eventId } = await params;
  const { event_saved, session_added, session_removed, session_error } = await searchParams;
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
    .single();

  if (!event) {
    notFound();
  }

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
    </div>
  );
}
```

Note on `datetime-local`: this input submits a wall-clock string with no
timezone info (e.g. `2026-09-12T09:00`). Task 3's `addEventSession`
already converts it using the location's own timezone
(`fromZonedTime`) before insert — the same class of concern the existing
booking flow handles via the location's timezone, and the write-side
counterpart to the `formatInTimeZone` calls used for display just above
in this same page.

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/locations/[locationId]/events/[eventId]/page.tsx
git commit -m "Add admin event detail page: edit details, manage sessions"
```

---

### Task 5: Player — global `/events` browse page, sidebar nav

**Files:**
- Create: `src/app/events/page.tsx`
- Modify: `src/components/AppShell.tsx` (add "Events" nav item)

**Interfaces:**
- Consumes: `groupEventsByCity` and `EVENT_TYPE_LABELS` from Task 2.
- Produces: `/events` route (linked from Task 6, Task 7).

- [ ] **Step 1: Write the page**

```tsx
// src/app/events/page.tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupEventsByCity } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function EventsPage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
    .neq("status", "draft");

  const eventsForGrouping = (events ?? []).map((e) => {
    const location = Array.isArray(e.location) ? e.location[0] : e.location;
    return {
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      city: location?.city ?? null,
      sessions: e.event_sessions,
    };
  });

  const { cities, otherEvents } = groupEventsByCity(eventsForGrouping, new Date());

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Events</h1>

      {cities.length === 0 && otherEvents.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No upcoming events yet.</p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {cities.map((cityGroup) => (
          <div key={cityGroup.city}>
            <h2 className="text-sm font-medium">{cityGroup.city}</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {cityGroup.events.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {otherEvents.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium">Other events</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {otherEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the sidebar nav item**

In `src/components/AppShell.tsx`, add a new active-state check alongside
the existing ones:

```tsx
  const eventsActive = pathname.startsWith("/events");
```

And add the link in the `<nav>`, immediately after "Find a Court":

```tsx
          <Link href="/" className={linkClass(findCourtActive)} onClick={() => setOpen(false)}>
            Find a Court
          </Link>
          <Link href="/events" className={linkClass(eventsActive)} onClick={() => setOpen(false)}>
            Events
          </Link>
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/events/page.tsx src/components/AppShell.tsx
git commit -m "Add player-facing global events browse page and nav item"
```

---

### Task 6: Player — `/events/[eventId]` detail page

**Files:**
- Create: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `EVENT_TYPE_LABELS` from Task 2.

- [ ] **Step 1: Write the page**

```tsx
// src/app/events/[eventId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { formatBookingDate } from "@/lib/dateFormat";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, status, capacity, location:locations(id, name, timezone, organization:organizations(id, name)), event_sessions(id, start_time, end_time, label, court:courts(name))"
    )
    .eq("id", eventId)
    .neq("status", "draft")
    .single();

  if (!event) {
    notFound();
  }

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

      {event.description && <p className="mt-3 text-sm">{event.description}</p>}
      {event.capacity && (
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">Capacity: {event.capacity}</p>
      )}
      {event.status === "cancelled" && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          This event has been cancelled.
        </p>
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
    </div>
  );
}
```

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/events/[eventId]/page.tsx
git commit -m "Add player-facing event detail page"
```

---

### Task 7: Player — events sections on city and location pages

**Files:**
- Modify: `src/app/cities/[city]/page.tsx`
- Modify: `src/app/locations/[locationId]/page.tsx`

**Interfaces:**
- Consumes: `sortBySoonestSession` and `EVENT_TYPE_LABELS` from Task 2.

- [ ] **Step 1: Add an "Events in {city}" section to the city page**

In `src/app/cities/[city]/page.tsx`, add the import and query, then render
a new section before the existing club list:

```tsx
import { clubsInCity } from "@/lib/cityGrouping";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";
```

```tsx
  const { data: allEvents } = await supabase
    .from("events")
    .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
    .neq("status", "draft");

  const eventsInCity = (allEvents ?? [])
    .map((e) => {
      const eventLocation = Array.isArray(e.location) ? e.location[0] : e.location;
      return {
        id: e.id,
        title: e.title,
        eventType: e.event_type,
        city: eventLocation?.city ?? null,
        sessions: e.event_sessions,
      };
    })
    .filter((e) => e.city === city);

  const upcomingEvents = sortBySoonestSession(eventsInCity, new Date());
```

Render, right after the `<h1>` and before the existing club `<ul>`:

```tsx
      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Events in {city}</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {upcomingEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium">Clubs</h2>
```

(Add that final `<h2>Clubs</h2>` immediately before the existing
`<ul className="mt-6 flex flex-col gap-3">{clubs.map(...` block, and
change that `<ul>`'s top margin from `mt-6` to `mt-2` to match the new
heading spacing — both sections should read as clearly separated groups
under the page's single `<h1>{city}</h1>`.)

- [ ] **Step 2: Add an "Upcoming Events" section to the location page**

In `src/app/locations/[locationId]/page.tsx`, add the import and query:

```tsx
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";
```

```tsx
  const { data: locationEvents } = await supabase
    .from("events")
    .select("id, title, event_type, event_sessions(start_time)")
    .eq("location_id", locationId)
    .neq("status", "draft");

  const upcomingEvents = sortBySoonestSession(
    (locationEvents ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      sessions: e.event_sessions,
    })),
    new Date()
  );
```

Render, right after the address block and before the existing courts
`<ul>` (adjust the courts section's own heading the same way as the city
page, so both sections are clearly labeled):

```tsx
      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Upcoming Events</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {upcomingEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium">Courts</h2>
```

(Same margin adjustment as Step 1: the existing courts `<ul>`'s top
margin changes from `mt-6` to `mt-2` to sit directly under its new
heading.)

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/cities/[city]/page.tsx src/app/locations/[locationId]/page.tsx
git commit -m "Add events sections to city and location pages"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers the
  schema-level checks).
- As an org admin: create an event at a location, add two sessions on
  different courts/times, confirm both appear in "Sessions"; try adding a
  session that overlaps an existing player booking or another event
  session on the same court and confirm the friendly "already booked"
  error (not a raw 500) and that no orphaned `event_sessions` row is left
  behind.
- Confirm the event's blocked time no longer appears as an open slot on
  the player-facing court booking page for that court/date (proves the
  `bookings` exclusion-constraint integration works without touching
  `computeOpenSlots`).
- Remove a session, confirm its time becomes bookable again immediately.
- Set an event to `draft` and confirm it does NOT appear on `/events`,
  the city page, the location page, or its own `/events/[eventId]` (which
  should 404). Set it to `published` and confirm it appears in all four
  places.
- Confirm `/events` groups correctly by city, sorted soonest-first, with
  an "Other events" bucket for any location with no `city` set (reuse the
  existing method of temporarily nulling a location's `city` to test this,
  same as prior features did).
- Confirm a staff-role account (not owner/admin) can create/edit an event
  and its sessions, matching the existing capability split.
