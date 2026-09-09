-- Lets a signed-in user create their own organization (self-serve club
-- signup), scoped tightly: they cannot self-activate it, and cannot do
-- this if they already belong to any org. Platform admins already have
-- an unconditional ALL policy on this table (0032_platform_admin.sql)
-- that permits the admin-assisted path with no change needed here --
-- permissive RLS policies for the same command are OR'd together.
create policy "organizations insert self" on organizations
  for insert
  with check (
    is_active = false
    and not exists (select 1 from org_members where user_id = auth.uid())
  );

-- Lets a user insert themselves as the owner of a brand-new org --
-- but only while that org still has zero members, which is what stops
-- this from being usable to claim an existing club. Platform admins
-- already have an unconditional ALL policy on this table too.
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (select 1 from org_members m where m.org_id = org_members.org_id)
  );
