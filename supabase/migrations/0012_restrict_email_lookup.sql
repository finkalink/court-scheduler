-- lookup_user_id_by_email (0010_club_admin_roles.sql) was grantable to any
-- authenticated user, not just org admins -- turning it into an
-- account-existence oracle for any signed-in player (confirm an arbitrary
-- email has an account, and learn its internal user id). Tighten it to
-- require the caller be an owner/admin of at least one org, matching how
-- list_org_member_emails (0011_org_member_emails.sql) was scoped correctly
-- from the start.
create or replace function public.lookup_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from users
  where lower(email) = lower(lookup_email)
    and exists (
      select 1 from org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    );
$$;
