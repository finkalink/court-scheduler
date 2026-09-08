-- Platform-wide admin role, independent of any org membership.
alter table users add column is_platform_admin boolean not null default false;

-- Lets a site admin hide a whole club from public browsing without
-- touching every location/court row underneath it.
alter table organizations add column is_active boolean not null default true;

-- Lets a site admin block a specific player from creating new
-- bookings/registrations without banning their auth account.
alter table users add column is_active boolean not null default true;

create function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_platform_admin from users where id = auth.uid()),
    false
  );
$$;

create function public.is_current_user_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_active from users where id = auth.uid()),
    true
  );
$$;

-- Platform admins get full cross-org access. Postgres OR-combines multiple
-- permissive policies per command, so these are additive to every existing
-- policy below -- nothing existing is dropped for this part.
create policy "organizations platform admin all" on organizations
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "org_members platform admin all" on org_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "users platform admin all" on users
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Public browsing must stop surfacing a deactivated org's locations, while
-- the org's own members (to manage/reactivate) and platform admins (to
-- review it) keep seeing it. This changes existing behavior, so the old
-- policy is dropped and replaced rather than added-to.
drop policy "locations select all" on locations;
create policy "locations select all" on locations
  for select using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from organizations o where o.id = locations.org_id and o.is_active
    )
  );

-- A deactivated player can't create new bookings...
drop policy "bookings insert own" on bookings;
create policy "bookings insert own" on bookings
  for insert with check (user_id = auth.uid() and public.is_current_user_active());

-- ...or new individual event registrations. Admin-assembled (org member)
-- and team-captain paths are untouched -- deactivation blocks
-- self-service, not being placed on a team by an admin.
drop policy "event_registrations insert own or captain or member" on event_registrations;
create policy "event_registrations insert own or captain or member" on event_registrations
  for insert with check (
    (user_id = auth.uid() and public.is_current_user_active())
    or exists (
      select 1 from event_teams t
      where t.id = team_id and t.captain_user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  );

-- Site-wide settings: key/value so more rows can be added later without a
-- migration. Publicly readable (the banner must render for logged-out
-- visitors on the landing page); writable only by platform admins.
create table site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

create policy "site_settings select all" on site_settings
  for select using (true);
create policy "site_settings write platform admin" on site_settings
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- No explicit grant statements: every other plain table in this schema
-- (organizations, locations, ...) relies on Supabase's default
-- public-schema privileges plus RLS alone, with explicit grants reserved
-- for VIEWS (booked_slots, event_registration_counts) that bypass owner
-- privileges. site_settings is a plain table, so it follows that same
-- convention.

insert into site_settings (key, value) values ('announcement_banner', '');

-- Bootstrap: seed the project owner as the first (and for now, only)
-- platform admin.
update users set is_platform_admin = true where email = 'bdfink.su@gmail.com';
