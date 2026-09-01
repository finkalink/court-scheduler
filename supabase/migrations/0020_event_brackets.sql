-- Special events, Plan 3: brackets. Layers on top of
-- events/event_sessions (0015/0016) and event_registrations/event_teams
-- (0017-0019). Payment integration is a separate future migration.

create table event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bracket text not null, -- 'winners' | 'losers' | 'round_robin' | 'pool_a', 'pool_b', ... | 'playoff'
  round_number integer not null,
  slot_in_round integer not null,
  team_a_registration_id uuid references event_registrations(id),
  team_b_registration_id uuid references event_registrations(id),
  team_a_advances_from_match_id uuid references event_matches(id),
  team_b_advances_from_match_id uuid references event_matches(id),
  advancement_type_a text check (advancement_type_a in ('winner', 'loser')),
  advancement_type_b text check (advancement_type_b in ('winner', 'loser')),
  winner_registration_id uuid references event_registrations(id),
  is_bye boolean not null default false,
  is_forfeit boolean not null default false,
  admin_note text,
  session_id uuid references event_sessions(id),
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'completed'))
);

create table event_match_sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references event_matches(id) on delete cascade,
  set_number integer not null check (set_number >= 1),
  team_a_points integer not null check (team_a_points >= 0),
  team_b_points integer not null check (team_b_points >= 0),
  unique (match_id, set_number)
);

alter table event_registrations add column display_name text;

alter table event_matches enable row level security;
alter table event_match_sets enable row level security;

-- Public read (non-sensitive schedule/result data, same tier as
-- events/event_sessions/event_teams). Write requires org membership --
-- staff included, matching every other day-to-day scheduling table.
create policy "event_matches select all" on event_matches
  for select using (true);
create policy "event_matches write member" on event_matches
  for insert with check (public.is_org_member(public.org_id_for_event(event_id)));
create policy "event_matches update member" on event_matches
  for update using (public.is_org_member(public.org_id_for_event(event_id)));
create policy "event_matches delete member" on event_matches
  for delete using (public.is_org_member(public.org_id_for_event(event_id)));

create policy "event_match_sets select all" on event_match_sets
  for select using (true);
create policy "event_match_sets write member" on event_match_sets
  for insert with check (
    public.is_org_member(public.org_id_for_event(
      (select event_id from event_matches where id = match_id)
    ))
  );
create policy "event_match_sets delete member" on event_match_sets
  for delete using (
    public.is_org_member(public.org_id_for_event(
      (select event_id from event_matches where id = match_id)
    ))
  );
-- No update policy on event_match_sets: correcting a set's score is
-- delete-and-reinsert (see recordMatchResult/editMatch), not an
-- in-place row edit -- same insert-or-delete convention as blocked_slots.

create index event_matches_event_idx on event_matches (event_id, bracket, round_number);
create index event_matches_session_idx on event_matches (session_id);
create index event_match_sets_match_idx on event_match_sets (match_id);
