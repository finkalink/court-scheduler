-- Tighten to owner/admin only -- staff no longer creates/edits courts or
-- locations (previously any org member could, via is_org_member).
drop policy "locations write member" on locations;
create policy "locations write admin" on locations
  for insert with check (public.is_org_admin(org_id));
drop policy "locations update member" on locations;
create policy "locations update admin" on locations
  for update using (public.is_org_admin(org_id));

drop policy "courts write member" on courts;
create policy "courts write admin" on courts
  for insert with check (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_admin(l.org_id)
    )
  );
drop policy "courts update member" on courts;
create policy "courts update admin" on courts
  for update using (
    exists (
      select 1 from locations l
      where l.id = courts.location_id and public.is_org_admin(l.org_id)
    )
  );

-- availability_rules, slot_overrides, and bookings policies are unchanged
-- (still is_org_member) -- staff keeps full access to hours and bookings.

-- Previously missing entirely: org_members had insert/delete but no update
-- policy, needed for changing an existing member's role.
create policy "org_members update admin" on org_members
  for update using (public.is_org_admin(org_id));

-- Narrow email -> user id lookup so an admin's "add by email" flow can find
-- an existing player account. The `users` table's own RLS only allows
-- selecting your own row, so this can't go through the normal client --
-- same security-definer pattern already used by is_org_member/is_org_admin,
-- deliberately scoped to return only an id, nothing else about the user.
create function public.lookup_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from users where lower(email) = lower(lookup_email);
$$;

grant execute on function public.lookup_user_id_by_email(text) to authenticated;
