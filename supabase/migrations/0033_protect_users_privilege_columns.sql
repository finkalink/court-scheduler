-- Discovered during manual verification of 0032_platform_admin.sql: the
-- pre-existing "users update own" policy (0002_rls.sql) is
-- `using (id = auth.uid())` with no with check at all (defaults to the
-- same condition), which places NO restriction on which columns a user
-- may change on their own row. Adding is_platform_admin/is_active in
-- 0032 turned that into a live, trivially-exploitable privilege
-- escalation: any signed-in user could PATCH their own row to set
-- is_platform_admin = true (self-promotion to platform admin) or flip
-- their own is_active back to true after being deactivated by an admin.
-- Confirmed live via a real PostgREST call with a real session token
-- (not a superuser bypass) before this fix; both writes succeeded.
--
-- Same pattern this codebase already established in
-- 0029_owner_row_protection.sql for org_members.role self-escalation,
-- adapted here to a preserve-current-value check (via a same-table
-- subquery reading the pre-statement snapshot) rather than a
-- block-one-specific-value check, since either direction (false->true or
-- true->false) of both columns needs protecting from self-modification.
-- A genuine platform admin's own profile edits still succeed: they
-- additionally satisfy "users platform admin all" (0032), which has no
-- such restriction.
drop policy "users update own" on users;
create policy "users update own" on users
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_platform_admin = (select u2.is_platform_admin from users u2 where u2.id = users.id)
    and is_active = (select u2.is_active from users u2 where u2.id = users.id)
  );
