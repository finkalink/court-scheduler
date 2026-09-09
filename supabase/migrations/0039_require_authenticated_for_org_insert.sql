-- Finding from a fourth adversarial review: "organizations insert self"
-- (0035) never required the caller be signed in at all. With no auth.uid()
-- (the anon role), user_has_any_membership() returns false and "not
-- (...)" passes, so an anonymous, unauthenticated request could insert
-- organizations rows. Confirmed live. Bounded in practice (the rows are
-- is_active=false, ownership_claimed=false, dataless, and anon can't
-- insert org_members to ever claim one), but it's still unbounded
-- unauthenticated row-growth spam with no reason to allow it -- this
-- policy was always meant to gate an authenticated user's own self-serve
-- creation, not anonymous requests.
drop policy "organizations insert self" on organizations;
create policy "organizations insert self" on organizations
  for insert
  with check (
    auth.uid() is not null
    and is_active = false
    and not public.user_has_any_membership()
  );
