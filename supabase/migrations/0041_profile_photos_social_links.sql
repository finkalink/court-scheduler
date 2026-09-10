-- Profile photos & social links. Both freely self-editable under the
-- existing "users update own" policy (0002_rls.sql) -- none of these are
-- the kind of privilege column 0023_protect_users_identity_columns.sql
-- exists to pin, same reasoning as gender/skill_level/share_stats_publicly
-- before them. avatar_url is never written from raw client input -- only
-- the /api/profile/avatar route sets it, after uploading to Storage itself.
alter table users add column avatar_url text;
alter table users add column instagram_handle text;
alter table users add column facebook_handle text;
alter table users add column twitter_handle text;

-- Public bucket: an avatar needs to render on a roster to any visitor with
-- no signed-URL round-trip, the same "public-select" tradeoff this schema
-- already makes for non-sensitive facility fields (0003_public_read.sql).
-- A public bucket serves downloads straight through Storage's public URL
-- without going through RLS at all -- but that only covers reads. An
-- authenticated upsert (re-uploading a new photo to the same fixed path)
-- still needs a SELECT policy: Storage's own upsert handling checks for an
-- existing row via a real, RLS-governed SELECT to decide insert vs update,
-- and with no SELECT policy that check itself is denied, surfacing as a
-- generic "row-level security policy" error on the whole upload -- found
-- live, by reproducing the exact request storage-js sends (including its
-- `x-upsert` header) directly against the API outside the SDK. Scoped to
-- the caller's own folder, same as the write policies below -- this does
-- not additionally expose anything a plain unauthenticated download of the
-- same public object wouldn't already.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar select own"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar insert own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar update own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Avatars are scoped as unconditionally visible wherever a player's name
-- already renders to other players (rosters), unlike share_stats_publicly-
-- gated stats -- so this is deliberately not folded into
-- filter_public_profile_user_ids (0025_public_profile_lookup_rpc.sql),
-- which only returns ids for opted-in players. Same RLS-bypass shape as
-- that function and its siblings (find_registered_user_by_email,
-- is_profile_complete_for_user): "users select own" (0002_rls.sql) would
-- otherwise block seeing anyone else's avatar_url at all. Returns only
-- id/avatar_url, nothing else.
create function public.get_avatar_urls(p_user_ids uuid[])
returns table(user_id uuid, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.avatar_url from users u where u.id = any(p_user_ids) and u.avatar_url is not null;
$$;

grant execute on function public.get_avatar_urls(uuid[]) to anon, authenticated;

-- get_public_player_stats (0024_public_player_profiles.sql) gains the new
-- profile fields -- a return-type change, so drop/recreate rather than
-- create or replace. avatar_url/social handles are only meaningful once
-- already gated by share_stats_publicly, same as name/skill_level today.
drop function public.get_public_player_stats(uuid);

create function public.get_public_player_stats(p_user_id uuid)
returns table(
  name text,
  skill_level text,
  wins int,
  losses int,
  games_played int,
  avatar_url text,
  instagram_handle text,
  facebook_handle text,
  twitter_handle text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_name text;
  v_skill_level text;
  v_opted_in boolean;
  v_avatar_url text;
  v_instagram_handle text;
  v_facebook_handle text;
  v_twitter_handle text;
begin
  select u.name, u.skill_level, u.share_stats_publicly, u.avatar_url,
    u.instagram_handle, u.facebook_handle, u.twitter_handle
  into v_name, v_skill_level, v_opted_in, v_avatar_url,
    v_instagram_handle, v_facebook_handle, v_twitter_handle
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
    count(*)::int,
    v_avatar_url,
    v_instagram_handle,
    v_facebook_handle,
    v_twitter_handle
  from my_matches;
end;
$$;

grant execute on function public.get_public_player_stats(uuid) to anon, authenticated;
