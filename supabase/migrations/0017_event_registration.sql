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
