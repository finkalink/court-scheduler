-- Lets any visitor (including anon) find out which of a batch of user ids
-- have opted in to public stats sharing, without being able to read any
-- other column on users -- "users select own" (0002_rls.sql) only lets a
-- player see their OWN row, so the plain select this replaced could never
-- see another opted-in player's row. Returns only id, never email/gender/
-- phone/etc, so this can't become a data leak the way a broadened RLS
-- policy on users would.
create function public.filter_public_profile_user_ids(p_user_ids uuid[])
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select u.id from users u where u.id = any(p_user_ids) and u.share_stats_publicly;
$$;

grant execute on function public.filter_public_profile_user_ids(uuid[]) to anon, authenticated;
