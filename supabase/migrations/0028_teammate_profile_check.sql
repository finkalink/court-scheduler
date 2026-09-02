-- Closes a gap flagged (not fixed) by the user-profiles plan: a
-- self-formed team's captain is the only registrant whose profile
-- completeness registerForEvent (src/app/actions/events.ts) actually
-- checks -- an existing account added as a teammate never has their own
-- profile checked before being rostered. This only covers a teammate
-- who already has an account (resolved via find_registered_user_by_email
-- to a real user_id) -- a pending invite has no account yet, so there is
-- nothing to check until they eventually sign up and claim it; that
-- half of the gap is a real, documented limitation, not silently
-- dropped.
--
-- Returns a bare boolean, not the profile fields themselves -- same
-- opaque-result pattern as find_registered_user_by_email (0021), so this
-- isn't a new way to read another player's name/gender/skill_level.
-- security definer needed because users' own RLS ("users select own")
-- only allows selecting the caller's own row.
create function public.is_profile_complete_for_user(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    name is not null
    and gender is not null
    and skill_level is not null
  from users
  where id = p_user_id;
$$;

grant execute on function public.is_profile_complete_for_user(uuid) to authenticated;
