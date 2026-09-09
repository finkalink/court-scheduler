-- Final whole-branch review finding: a platform-admin-deactivated user
-- (users.is_active = false) could still self-serve create a pending org
-- and take ownership of it. is_current_user_active() (0032) exists for
-- exactly this -- already applied to "bookings insert own" and
-- "event_registrations insert own or captain or member" -- but was never
-- applied to either new policy from this feature. Confirmed live before
-- this fix: a deactivated test account's organizations insert succeeded.
drop policy "organizations insert self" on organizations;
create policy "organizations insert self" on organizations
  for insert
  with check (
    auth.uid() is not null
    and public.is_current_user_active()
    and is_active = false
    and not public.user_has_any_membership()
  );

drop policy "org_members insert self as first member" on org_members;
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and public.is_current_user_active()
    and role = 'owner'
    and not public.user_has_any_membership()
    and exists (
      select 1 from organizations o where o.id = org_id and o.ownership_claimed = false
    )
  );
