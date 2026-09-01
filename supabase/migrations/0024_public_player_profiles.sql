-- Public-facing player profiles. Off by default (opt-in, not opt-out) --
-- editable via the existing self-service "users update own" path; the
-- identity-column protection trigger (0023_protect_users_identity_columns.sql)
-- only blocks email/role, so this stays freely self-editable like
-- name/gender/skill_level already are.
alter table users add column share_stats_publicly boolean not null default false;

-- Returns a player's public stats ONLY if they've opted in -- an empty
-- result set is returned identically whether p_user_id doesn't exist OR
-- exists but hasn't opted in, so this can never be used to probe account
-- existence (same care already taken with find_registered_user_by_email,
-- 0021_team_roster_invites.sql). Granted to anon as well as authenticated
-- -- this page works for a signed-out visitor, matching every other
-- player-facing page in this app.
create function public.get_public_player_stats(p_user_id uuid)
returns table(name text, skill_level text, wins int, losses int, games_played int)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_name text;
  v_skill_level text;
  v_opted_in boolean;
begin
  select u.name, u.skill_level, u.share_stats_publicly
  into v_name, v_skill_level, v_opted_in
  from users u
  where u.id = p_user_id;

  if v_opted_in is not true then
    return;
  end if;

  return query
  with my_registrations as (
    -- Every event_registrations row this player is credited for: their
    -- own direct individual registrations, plus every team registration
    -- for any team they've ever been a roster member of.
    select er.id from event_registrations er where er.user_id = p_user_id
    union
    select er.id
    from event_registrations er
    join event_team_members m on m.team_id = er.team_id
    where m.user_id = p_user_id
  ),
  my_matches as (
    select em.winner_registration_id
    from event_matches em
    where em.status = 'completed'
      and em.is_bye = false -- a bye isn't a game played -- nobody actually played
      and (em.team_a_registration_id in (select id from my_registrations)
        or em.team_b_registration_id in (select id from my_registrations))
      -- forfeits ARE included -- a recorded forfeit is a real win/loss,
      -- same as how real sports standings treat it
  )
  select
    v_name,
    v_skill_level,
    count(*) filter (where winner_registration_id in (select id from my_registrations))::int,
    count(*) filter (where winner_registration_id is not null and winner_registration_id not in (select id from my_registrations))::int,
    count(*)::int
  from my_matches;
end;
$$;

grant execute on function public.get_public_player_stats(uuid) to anon, authenticated;
