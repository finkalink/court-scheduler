-- Blind Draw needs each ungrouped registrant's skill_level to balance teams,
-- on top of the email list_event_registrant_emails (0017) already exposes.
-- New function rather than changing that one -- assembleEventTeam doesn't
-- need skill data and there's no reason to touch its working query. Same
-- security posture: caller must be an org member of the event, no wider
-- surface than the existing function.
create function public.list_event_registrant_profiles(check_event_id uuid)
returns table(user_id uuid, email text, skill_level text)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.email, u.skill_level
  from event_registrations r
  join users u on u.id = r.user_id
  where r.event_id = check_event_id
    and r.user_id is not null
    and r.status <> 'cancelled'
    and public.is_org_member(public.org_id_for_event(check_event_id));
$$;

grant execute on function public.list_event_registrant_profiles(uuid) to authenticated;
