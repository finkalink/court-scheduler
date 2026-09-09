-- Critical finding from a third adversarial review: ownership_claimed
-- (0037) was never pinned in "organizations update admin"'s with_check,
-- the same way 0034 already pins is_active -- 0034 was written before
-- this column existed, so it doesn't cover it. Any org admin could
-- UPDATE their own org's ownership_claimed back to false, reopening it
-- to a takeover by an unrelated stranger, or (combined with self-
-- demotion) letting an admin escalate to sole owner and evict the real
-- owners -- exactly the boundary 0029_owner_row_protection.sql exists
-- to defend. Confirmed live. Closed the same way 0034 closed the
-- identical hazard for is_active: pin the column to its current stored
-- value unless the actor is already a platform admin (who bypass via
-- their own separate ALL policy).
drop policy "organizations update admin" on organizations;
create policy "organizations update admin" on organizations
  for update
  using (is_org_admin(id))
  with check (
    is_org_admin(id)
    and is_active = (select o2.is_active from organizations o2 where o2.id = organizations.id)
    and ownership_claimed = (select o2.ownership_claimed from organizations o2 where o2.id = organizations.id)
  );

-- Defense in depth, flagged by the same review: an existing org member
-- shouldn't be able to claim ownership of ANY unclaimed org -- even a
-- legitimately brand-new one that isn't theirs -- via the first-member
-- policy. Mirrors the one-self-serve-org-at-a-time intent
-- "organizations insert self" already enforces on the organizations
-- side. Note: this does not by itself close the finding above (a fresh,
-- membership-free account could still exploit the unpinned column) --
-- the with_check fix above is what actually closes it; this narrows an
-- unrelated asymmetry the same review pointed out alongside it.
drop policy "org_members insert self as first member" on org_members;
create policy "org_members insert self as first member" on org_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not public.user_has_any_membership()
    and exists (
      select 1 from organizations o where o.id = org_id and o.ownership_claimed = false
    )
  );
