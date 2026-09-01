-- Team roster visibility & membership integrity. Layers on top of
-- event_teams/event_team_members (0017-0019). Every NEW roster spot
-- must resolve to a real account -- immediately (user_id) or eventually
-- (invited_email, claimed at the teammate's first sign-in). Pre-existing
-- free-text-only rows (neither column set) are left alone, no backfill.

alter table event_team_members add column invited_email text;

-- One pending invite per email at a time, app-wide -- keeps the
-- sign-in-time claim lookup a single unambiguous match.
create unique index event_team_members_invited_email_unique
  on event_team_members (invited_email)
  where invited_email is not null;

-- Exact-match lookup, callable by any authenticated user (not just org
-- members -- any player can be a team captain). Returns only an opaque
-- user_id for an email the caller already typed themselves; not a new
-- enumeration surface since it confirms/denies one specific email at a
-- time, never a list. security definer needed because users' own RLS
-- only allows selecting your own row.
create function public.find_registered_user_by_email(check_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from users where email = check_email;
$$;

grant execute on function public.find_registered_user_by_email(text) to authenticated;

-- Links any pending invite addressed to the CALLER's own verified email
-- to the caller's own account. Takes no parameters and never trusts a
-- client-supplied identity -- auth.uid()/auth.users only -- so a roster
-- spot can only ever be linked to the account that actually owns that
-- inbox. Called on every sign-in (src/app/actions/auth.ts), not at
-- signup: this app requires email confirmation before a session exists,
-- so signUp() has no authenticated caller to attribute a claim to yet.
create function public.claim_pending_team_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return;
  end if;

  update event_team_members
  set user_id = auth.uid(), invited_email = null
  where invited_email = v_email and user_id is null;
end;
$$;

grant execute on function public.claim_pending_team_invites() to authenticated;
