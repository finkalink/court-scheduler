-- Helper: is the current user a member (any role) of this org?
-- security definer + a plain function (not a policy subquery on org_members
-- itself) avoids RLS-on-itself recursion when org_members' own policies
-- need to check membership.
create function public.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

-- Helper: is the current user an owner/admin (not just staff) of this org?
create function public.is_org_admin(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- Helper: org_id that owns a given court, via locations.
create function public.org_id_for_court(check_court_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select l.org_id from courts c
  join locations l on l.id = c.location_id
  where c.id = check_court_id;
$$;

alter table organizations enable row level security;
alter table org_members enable row level security;
alter table locations enable row level security;
alter table courts enable row level security;
alter table availability_rules enable row level security;
alter table slot_overrides enable row level security;
alter table bookings enable row level security;
alter table users enable row level security;

-- users: a user can see and update only their own profile row.
create policy "users select own" on users
  for select using (id = auth.uid());
create policy "users update own" on users
  for update using (id = auth.uid());

-- organizations: readable by members; writable by owner/admin.
create policy "organizations select member" on organizations
  for select using (public.is_org_member(id));
create policy "organizations update admin" on organizations
  for update using (public.is_org_admin(id));

-- org_members: members of an org can see its roster; owner/admin can manage it.
create policy "org_members select member" on org_members
  for select using (public.is_org_member(org_id));
create policy "org_members insert admin" on org_members
  for insert with check (public.is_org_admin(org_id));
create policy "org_members delete admin" on org_members
  for delete using (public.is_org_admin(org_id));

-- locations: any authenticated user can read (players need to see it to book);
-- only the owning org's members can write.
create policy "locations select all" on locations
  for select using (auth.role() = 'authenticated');
create policy "locations write member" on locations
  for insert with check (public.is_org_member(org_id));
create policy "locations update member" on locations
  for update using (public.is_org_member(org_id));

-- courts: same pattern as locations.
create policy "courts select all" on courts
  for select using (auth.role() = 'authenticated');
create policy "courts write member" on courts
  for insert with check (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_member(l.org_id)
    )
  );
create policy "courts update member" on courts
  for update using (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_member(l.org_id)
    )
  );

-- availability_rules: readable by anyone authenticated; writable only by the
-- owning org's members.
create policy "availability_rules select all" on availability_rules
  for select using (auth.role() = 'authenticated');
create policy "availability_rules write member" on availability_rules
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "availability_rules update member" on availability_rules
  for update using (public.is_org_member(public.org_id_for_court(court_id)));
create policy "availability_rules delete member" on availability_rules
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));

-- slot_overrides: same pattern as availability_rules.
create policy "slot_overrides select all" on slot_overrides
  for select using (auth.role() = 'authenticated');
create policy "slot_overrides write member" on slot_overrides
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "slot_overrides update member" on slot_overrides
  for update using (public.is_org_member(public.org_id_for_court(court_id)));
create policy "slot_overrides delete member" on slot_overrides
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));

-- bookings: a player can insert/select only their own bookings; org members
-- can select all bookings for their org's courts (to manage the calendar).
create policy "bookings select own" on bookings
  for select using (user_id = auth.uid());
create policy "bookings select org member" on bookings
  for select using (public.is_org_member(public.org_id_for_court(court_id)));
create policy "bookings insert own" on bookings
  for insert with check (user_id = auth.uid());
create policy "bookings update own or member" on bookings
  for update using (
    user_id = auth.uid() or public.is_org_member(public.org_id_for_court(court_id))
  );

-- booked_slots view: exposes only court_id/start_time/end_time for confirmed
-- bookings (no user_id, no price) so the player-facing availability
-- calculator can see which ranges are taken without exposing other
-- players' identities. Owned by the migration role (not "invoker"), so it
-- runs with the view owner's privileges and bypasses bookings' base RLS —
-- that's what lets it show cross-user booking ranges through a narrow,
-- non-identifying column set.
create view booked_slots
with (security_invoker = false)
as
  select court_id, start_time, end_time
  from bookings
  where status = 'confirmed';

grant select on booked_slots to authenticated;
