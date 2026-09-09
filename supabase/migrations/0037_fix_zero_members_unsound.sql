-- A second, deeper finding from adversarial review of 0035/0036: "zero
-- members" is NOT equivalent to "brand new, never owned" -- an org can
-- legitimately reach zero members long after creation (org_members.user_id
-- references auth.users(id) on delete cascade, so a sole owner deleting
-- their auth account silently empties the org; an owner can also drain
-- every member, including their own row, via the existing
-- "org_members delete admin" policy). 0036's org_has_members() check was
-- reasoning from a false premise, not just a wrong implementation: any
-- org that ever loses its last member becomes permanently claimable by a
-- stranger, not just for a few milliseconds after creation. Confirmed
-- live by the reviewer: drain an org's members, then insert yourself as
-- owner of the real, populated, active "Ace Volleyball Club".
--
-- Fixed by tracking the real invariant directly instead of inferring it
-- from a count that can go back to zero: a durable, one-way
-- "ownership_claimed" flag on organizations, set permanently the instant
-- any member is ever added, via a trigger (so it can never be forgotten
-- or bypassed by app code, or reset by later member removal). The
-- org_members insert policy checks this flag on the public, fully
-- readable organizations table (organizations select all is
-- using(true)) rather than a subquery on org_members' own rows -- no
-- security definer function even needed for this specific check, since
-- there's nothing hidden being read.
alter table organizations add column ownership_claimed boolean not null default false;

-- Every existing org that already has a member was, by definition,
-- already claimed -- back-fill so this migration can't itself create a
-- "claimable" state out of currently-healthy orgs.
update organizations
set ownership_claimed = true
where id in (select distinct org_id from org_members);

create function public.mark_org_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update organizations set ownership_claimed = true where id = new.org_id;
  return new;
end;
$$;

create trigger org_members_mark_claimed
after insert on org_members
for each row
execute function public.mark_org_claimed();

drop policy "org_members insert self as first member" on org_members;
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from organizations o where o.id = org_id and o.ownership_claimed = false
    )
  );

-- org_has_members() is superseded by the ownership_claimed flag above --
-- it reasoned from the same unsound "count is zero" premise this
-- migration is fixing, and nothing else references it.
drop function public.org_has_members(uuid);

-- Second finding from the same review: a plain SELECT on org_members
-- (via is_org_member) can't see a row that the SAME statement is still
-- inserting, so INSERT ... RETURNING on this table silently 42501s even
-- when the insert itself is fully permitted -- a sharp trap for any
-- future code that adds `.select()` to this insert. Let a user always
-- see their own membership row regardless of what else is visible yet.
create policy "org_members select own" on org_members
  for select
  using (user_id = auth.uid());

-- Third finding: "organizations insert self" (0035) has the exact same
-- shape that caused the original bug -- a raw subquery on org_members,
-- correct today only because the rows it needs (the caller's own) are
-- exactly the rows org_members' SELECT policy already exposes to them.
-- Any future narrowing of that SELECT policy would silently turn this
-- into "user has no memberships" for everyone. Made robust the same way
-- 0036 fixed the original bug: a security definer helper that sees the
-- real state regardless of the caller's own row-level visibility.
create function public.user_has_any_membership()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from org_members where user_id = auth.uid());
$$;

drop policy "organizations insert self" on organizations;
create policy "organizations insert self" on organizations
  for insert
  with check (
    is_active = false
    and not public.user_has_any_membership()
  );
