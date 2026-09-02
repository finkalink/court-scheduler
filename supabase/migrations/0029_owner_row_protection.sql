-- Closes a gap flagged, not fixed, by the club-admins plan: org_members'
-- update/delete policies only checked is_org_admin (owner OR admin), so
-- any admin -- not just an owner -- could demote or remove an owner, and
-- the insert/update policies had no restriction at all on setting
-- role = 'owner' directly, a privilege-escalation path the app's own
-- addOrgMember/updateOrgMemberRole never exposed (roleInput there is
-- always coerced to 'admin'/'staff') but a direct API call could still
-- reach. src/app/admin/actions.ts gained an app-level canActOnMember
-- check for the friendly-error path; this is the DB-level backstop,
-- consistent with this project's RLS-is-the-real-check convention.

-- Helper: is the current user specifically an owner (not just admin) of
-- this org? Same pattern as is_org_member/is_org_admin (0002_rls.sql).
create function public.is_org_owner(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid() and role = 'owner'
  );
$$;

drop policy "org_members insert admin" on org_members;
create policy "org_members insert admin" on org_members
  for insert
  with check (public.is_org_admin(org_id) and (role <> 'owner' or public.is_org_owner(org_id)));

drop policy "org_members update admin" on org_members;
create policy "org_members update admin" on org_members
  for update
  using (public.is_org_admin(org_id) and (role <> 'owner' or public.is_org_owner(org_id)))
  with check (public.is_org_admin(org_id) and (role <> 'owner' or public.is_org_owner(org_id)));

drop policy "org_members delete admin" on org_members;
create policy "org_members delete admin" on org_members
  for delete
  using (public.is_org_admin(org_id) and (role <> 'owner' or public.is_org_owner(org_id)));
