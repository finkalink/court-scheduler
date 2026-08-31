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
