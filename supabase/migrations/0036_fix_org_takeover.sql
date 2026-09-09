-- Fix for a critical finding from the org-creation review: the "zero
-- members" check in "org_members insert self as first member" (0035) was
-- a raw policy subquery on org_members itself, so it was evaluated
-- through org_members' own "select member" policy (using
-- is_org_member(org_id)) -- which a non-member can't see past. That made
-- "not exists (...)" true for EVERY org the attacker doesn't belong to,
-- not just empty ones, letting any authenticated user insert themselves
-- as owner of any existing, active, populated club.
--
-- Fixed the same way 0002_rls.sql's own comment already prescribes for
-- this exact hazard: a security definer function, not a policy subquery
-- on the table the policy itself protects. security definer runs with
-- the function owner's privileges, so it sees the org's real member
-- count regardless of the caller's own row-level visibility.
create function public.org_has_members(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members where org_id = check_org_id
  );
$$;

drop policy "org_members insert self as first member" on org_members;
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not public.org_has_members(org_id)
  );
