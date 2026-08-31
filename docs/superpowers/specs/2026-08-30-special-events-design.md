# Special Events (Tournaments, Leagues, Open Play, Clinics) — Design Spec

Status: approved as spec — captured for future implementation, not scheduled yet
Date: 2026-08-30

## Goal

Give each location a way to host events beyond regular slot-based court
booking: tournaments (with brackets), leagues (multi-week seasons with
standings), open-play/pickup sessions, and clinics/lessons. One shared
data model and UI framework covers all four event types via type-specific
extensions, rather than four separate systems.

This spec **supersedes** the standalone "Open Play" (v4) and "Leagues and
tournament brackets" (v5) entries in `CLAUDE.md`'s build order with one
consolidated design. It does not change *when* this gets built — v3
(Stripe Connect payments) and the current v4/v5 slot are still ahead of it
in the stated build order ("build each phase fully before starting the
next, don't build ahead speculatively"). This document exists so the
design work is done and ready when that time comes, the same way the
`v2-org-creation-deferred` spec captured a paused decision for later pickup.

## Non-goals (for this spec's scope)

- **No implementation yet.** This is a design document, not an
  implementation plan. When picked up, it decomposes into several
  separate implementation plans (see "Future Decomposition" below) —
  each goes through its own brainstorm-confirm → plan → build cycle.
- **No live payment processing.** The schema reserves fields for pricing
  (`events.fee_cents`, `event_registrations.payment_status`) so no later
  migration is needed, but no Stripe integration ships with this feature.
  Until v3 exists, org admins should leave `fee_cents` null — a
  fee-bearing event isn't actually sellable without it.
- **No persistent, cross-event teams.** Teams (`event_teams`) are scoped
  to a single event, not a standing "club team" entity reused across
  multiple tournaments/seasons. If that's wanted later, it's a separate,
  additive change on top of this model, not a prerequisite for it.
- **No invite/accept flow for team rosters.** A team captain lists
  teammates by name/email in one step; teammates without an existing
  account are just recorded as a name on the roster, not sent an
  invitation to create one. A real invite flow is a plausible future
  enhancement, not part of this spec.

## Data model

### Core: events and sessions

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  location_id uuid not null references locations(id),
  event_type text not null check (event_type in ('tournament', 'league', 'open_play', 'clinic')),
  title text not null,
  description text,
  registration_mode text not null check (registration_mode in ('team', 'individual')),
  -- only meaningful when registration_mode = 'team'; null otherwise
  team_formation text check (team_formation in ('self_formed', 'admin_assembled')),
  capacity integer, -- max registered units (teams or individuals); null = unlimited
  fee_cents integer, -- null = free; not chargeable until v3 payments exists
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
  label text -- "Week 3", "Round 1"; null for a single-session event
);
```

One `events` row per tournament/league/clinic/open-play instance.
`event_sessions` is what makes leagues work as "one event, many sessions"
— a season is one `events` row with N `event_sessions` rows, each with
its own court/time. A one-off tournament or clinic just has a single
`event_sessions` row (or a few, if it spans a whole day across several
courts).

### Court-blocking: reusing the existing double-booking guarantee

Rather than a parallel blocking mechanism, each `event_sessions` row also
creates a row in the existing `bookings` table:

```sql
alter table bookings add column source text not null default 'player'
  check (source in ('player', 'event'));
alter table bookings add column event_session_id uuid references event_sessions(id);
alter table bookings alter column user_id drop not null;
alter table bookings add constraint bookings_source_shape check (
  (source = 'player' and user_id is not null and event_session_id is null) or
  (source = 'event' and user_id is null and event_session_id is not null)
);
```

This means an event's reserved court time is governed by the *same*
`exclude using gist (...)` constraint that already makes double-booking
impossible — no new conflict-checking logic needed, and it's symmetric:
a player can't book over an event's time, and two events can't double-book
the same court either. `computeOpenSlots` already treats existing
`bookings` rows as occupied, so event time disappears from the player
booking grid automatically, the same way an existing player booking does
today.

### Team formation & registration

```sql
create table event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  captain_user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table event_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references event_teams(id) on delete cascade,
  user_id uuid references users(id), -- linked account, if the teammate has one
  display_name text not null,        -- always present, so a roster can list someone without an account
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
```

`event_registrations` is the thing capacity/waitlist counts against — one
row per team *or* per individual, regardless of team size.
`event_teams`/`event_team_members` is the roster itself, kept as a
separate concern so it works for both team-formation modes:

- **Self-formed:** the captain fills in a team name + roster (names/
  emails — no account required for a teammate to be listed) in one step,
  creating `event_teams` + `event_team_members` + one
  `event_registrations` row with `team_id` set, immediately.
- **Admin-assembled:** players register individually
  (`event_registrations` rows with `user_id` set, `team_id` null). After
  registration closes, an admin groups registrants into `event_teams`; at
  that point each grouped registrant's row gets `team_id` set and the
  team becomes the unit used for bracket seeding.

**Waitlist:** once `events.capacity` `'registered'` rows exist for an
event, new signups land as `'waitlisted'` (ordered by `registered_at`).
Cancelling a `'registered'` row is a server action (matching this app's
existing `cancelBooking` pattern, not the DB-constraint pattern reserved
specifically for the double-booking guarantee) that promotes the oldest
`'waitlisted'` row to `'registered'`.

### Brackets & standings

One generic table covers single-elimination, double-elimination, round
robin, and pool play — rather than a different schema per format:

```sql
create table event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bracket text not null, -- 'winners' | 'losers' | 'pool_a' | 'round_robin' | 'playoff' -- free-form label, not a fixed enum
  round_number integer not null,   -- ordering within its bracket
  slot_in_round integer not null,  -- position within the round, for bracket-tree layout
  team_a_registration_id uuid references event_registrations(id),
  team_b_registration_id uuid references event_registrations(id),
  team_a_advances_from_match_id uuid references event_matches(id), -- self-FK: this slot fills from an earlier match's result
  team_b_advances_from_match_id uuid references event_matches(id),
  advancement_type_a text check (advancement_type_a in ('winner', 'loser')),
  advancement_type_b text check (advancement_type_b in ('winner', 'loser')),
  winner_registration_id uuid references event_registrations(id),
  score text, -- free-text score display, e.g. "21-18, 21-15"
  session_id uuid references event_sessions(id), -- set only if this match has its own dedicated time/court
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'completed'))
);
```

- **Single/double elimination:** matches reference each other via
  `*_advances_from_match_id` — a semifinal's slot is filled by "winner of
  match 7," known before that match is even played. Double-elim adds a
  `'losers'` bracket whose early rounds fill via
  `advancement_type = 'loser'` from the winners bracket.
- **Round robin / pool play:** a flat set of matches in one `bracket`
  group with no advancement links — every pair plays once.
- **Pool play → playoffs:** pool matches feed a `'playoff'`-bracket match
  the same way an elimination round does — same mechanism, no special
  case.
- **Standings** (league win/loss records, pool-play seeding) are computed
  from `event_matches` results on the fly, not stored redundantly —
  consistent with this app's existing "bookable slots are computed on the
  fly, not pre-generated" principle for `availability_rules`.

A match doesn't need its own `event_sessions` row if several matches
share one block of court time (e.g. pool play worked through
back-to-back on one court) — `session_id` is only set when a match has a
genuinely dedicated slot.

## RLS

Following the established two-tier pattern (`is_org_member` vs
`is_org_admin`) from the club-admins work:

- `events`, `event_sessions`, `event_teams`, `event_team_members`,
  `event_matches`: publicly readable (`using (true)`), matching every
  other player-visible facility/schedule table — learning from the
  earlier gap where `availability_rules`/`slot_overrides` had to be
  fixed after the fact. Write access requires `is_org_member` for the
  event's org — same tier as `availability_rules`/`slot_overrides`/
  `blocked_slots` (staff can run day-to-day event scheduling, not just
  owners/admins).
- `event_registrations`: readable by the registrant (`user_id = auth.uid()`
  or membership on a `event_teams` row they're on) and by org members for
  that event's org; writable by the registrant (create/cancel their own)
  and by org members (for admin-assembled team formation, waitlist
  promotion, marking payment status).

## Navigation & UI shape

Events get a presence at every level of the existing City → Club →
Location hierarchy, not just added as a single new page:

1. **`/events` (new, global)** — City-grouped, soonest-first browse of
   every event, reusing the `groupLocationsByCity`-style grouping pattern
   already built for the home page, applied to events' locations instead.
2. **`/cities/[city]` (existing, gains a section)** — an "Events in
   {city}" section alongside the existing club list, so a player who's
   drilled into a city sees both clubs and what's happening there.
3. **`/locations/[locationId]` (existing, gains a section)** — an
   "Upcoming Events" section alongside the existing court list.
4. **`/events/[eventId]` (new)** — detail + registration page; all of the
   above link into it.
5. **`/events/registrations` (new)** — a player's own event registrations
   (team or individual), the "My Events" equivalent of the existing
   `/bookings` page. Kept as its own page rather than folded into
   `/bookings`, since registration status (registered/waitlisted/
   cancelled, team roster) is a different shape than a single time-slot
   booking.
6. **Sidebar (`AppShell.tsx`)** — a new "Events" item alongside "Find a
   Court" and "My Bookings", plus "My Events" for the registrations page
   above.
7. **`/admin/locations/[locationId]/events` (new)** — event list/create
   for that location, alongside the existing "Courts" list on that page
   (not nested under a specific court, since an event can span multiple
   courts/sessions).
8. **`/admin/locations/[locationId]/events/[eventId]` (new)** — manage
   sessions, registrations/team assembly, and match results. Access
   follows the same gating as hours/availability today (any org member —
   owner/admin/staff), not owner/admin-only.

## Future decomposition

When this is picked up for implementation, it splits into separate
plans rather than one giant build, each going through its own
brainstorm-confirm → plan → build cycle:

1. **Core events + sessions + court-blocking** — `events`,
   `event_sessions`, the `bookings` schema change, admin create/edit UI,
   player-facing browse/detail pages (without registration yet).
2. **Registration, teams, and waitlist** — `event_registrations`,
   `event_teams`, `event_team_members`, both team-formation flows,
   capacity/waitlist mechanics, the "My Events" page.
3. **Brackets** — `event_matches`, bracket generation (seeding into
   round 1 given N registrations), the bracket-tree UI, match-result
   entry, standings computation for round robin/pool play.
4. **Payment integration** — depends on v3 (Stripe Connect) already
   existing; wires `fee_cents`/`payment_status` to actual charges.

Each plan is independently shippable and testable — e.g. plan 1 alone
already lets an org host a free, capacity-unlimited open-play session
with no bracket, which is meaningful on its own.
