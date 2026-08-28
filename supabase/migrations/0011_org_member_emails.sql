-- The /admin/team roster page needs to show each member's email, but the
-- `users` table's own RLS ("users select own") only lets someone read their
-- own row -- a direct `.from("users").select(...).in("id", ...)` query from
-- an org admin silently returns zero other-member rows. Same shape of gap
-- as the email->id lookup in 0010_club_admin_roles.sql, fixed the same way:
-- a narrow security-definer function, this time scoped to members of one
-- org (via is_org_member) rather than open to any authenticated caller.
create function public.list_org_member_emails(target_org_id uuid)
returns table(user_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.email
  from users u
  join org_members om on om.user_id = u.id
  where om.org_id = target_org_id
    and public.is_org_member(target_org_id);
$$;

grant execute on function public.list_org_member_emails(uuid) to authenticated;
