-- Security fix: "users update own" (0002_rls.sql) only restricts WHICH ROW
-- can be updated (id = auth.uid()) -- Postgres RLS is row-level only, so
-- it does NOT restrict which columns a player can change on their own
-- row. That meant a player could self-edit `email` (spoofing someone
-- else's real address to get linked into a captain's team roster in
-- their place via find_registered_user_by_email, 0021_team_roster_invites.sql
-- -- and the same trust assumption is shared by lookup_user_id_by_email,
-- list_org_member_emails, and list_event_registrant_emails) or `role`
-- (a latent self-promotion-to-org_admin vector -- not exploitable today
-- since nothing currently authorizes off users.role, but that's a
-- fragile thing to rely on).
--
-- RLS can't express "this column is read-only" directly, so this is the
-- standard Postgres pattern instead: a BEFORE UPDATE trigger that rejects
-- any attempt to change email/role via the self-service update path.
-- name/gender/skill_level (the only columns updateProfile ever touches)
-- stay freely self-editable. phone is left alone too -- nothing writes to
-- it anywhere in the app, so it isn't part of the identified risk.

create function public.prevent_users_identity_column_changes()
returns trigger
language plpgsql
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'email cannot be changed via this update';
  end if;
  if new.role is distinct from old.role then
    raise exception 'role cannot be changed via this update';
  end if;
  return new;
end;
$$;

create trigger users_protect_identity_columns
  before update on users
  for each row
  execute procedure public.prevent_users_identity_column_changes();
