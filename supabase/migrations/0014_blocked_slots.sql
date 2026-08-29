-- Per-slot blocking, layered on top of availability_rules (recurring) and
-- slot_overrides (whole-day/custom-hours one-offs). A row with day_of_week
-- set blocks that slot every week on that day; a row with date set blocks
-- it for just that one date -- exactly one of the two is ever set. Block
-- granularity always matches the court's own slot_size_minutes (same value
-- computeOpenSlots already uses for durationMinutes/stepMinutes), so a
-- blocked start_time lines up exactly with a real candidate booking start
-- -- no overlap math needed, just exact-time-of-day matching.
create table blocked_slots (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id) on delete cascade,
  day_of_week smallint check (day_of_week between 0 and 6),
  date date,
  start_time time not null,
  check ((day_of_week is not null) <> (date is not null))
);

create unique index blocked_slots_recurring_unique
  on blocked_slots (court_id, day_of_week, start_time)
  where day_of_week is not null;

create unique index blocked_slots_date_unique
  on blocked_slots (court_id, date, start_time)
  where date is not null;

create index blocked_slots_court_idx on blocked_slots (court_id);

alter table blocked_slots enable row level security;

-- Public select from the start -- learned from the earlier gap where
-- availability_rules/slot_overrides were initially authenticated-only and
-- broke anonymous browsing of the court page until 0003_public_read.sql
-- fixed it. Write access matches slot_overrides: any org member (including
-- staff), not owner/admin-only -- this is a "timing" action per the
-- club-admins capability split.
create policy "blocked_slots select all" on blocked_slots
  for select using (true);
create policy "blocked_slots write member" on blocked_slots
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "blocked_slots delete member" on blocked_slots
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));
