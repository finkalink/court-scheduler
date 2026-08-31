-- Fixes 3 gaps found in the final whole-branch review of the event
-- registration plan (0017/0018):
--
-- 1. event_teams/event_team_members had no DELETE policy at all -- the
--    roster-rollback-on-failure logic in registerForEvent silently no-ops
--    (0 rows deleted, no error under RLS), leaving an orphaned team that
--    then causes a permanent "already registered" lockout on the event
--    detail page.
-- 2. event_registrations' update policy had a `using` clause but no
--    `with check` -- Postgres reuses `using` for the new row when no
--    `with check` is given, which only constrains *ownership*, not
--    column values. A registrant could directly PATCH their own row from
--    'waitlisted' to 'registered', jumping the queue -- the same class of
--    bug the registered_at trigger (0018) closed on the insert path,
--    reached here via update instead.
-- 3. Broadening "who can act on a team's registration" from
--    captain-only to any team member -- self-formed teams already always
--    include the captain as an event_team_members row (see
--    registerForEvent), so this is a strict superset for that case, and
--    it additionally makes an admin-assembled team's registration
--    (captain_user_id is null -- no captain exists at all) cancellable by
--    any of its members, closing a previously-uncancellable dead end.

create policy "event_teams delete member or captain" on event_teams
  for delete using (
    public.is_org_member(public.org_id_for_event(event_id))
    or captain_user_id = auth.uid()
  );

create policy "event_team_members delete member or captain" on event_team_members
  for delete using (
    exists (
      select 1 from event_teams t
      where t.id = team_id
        and (t.captain_user_id = auth.uid() or public.is_org_member(public.org_id_for_event(t.event_id)))
    )
  );

drop policy "event_registrations update own or captain or member" on event_registrations;
create policy "event_registrations update own or captain or member" on event_registrations
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from event_team_members m
      where m.team_id = event_registrations.team_id and m.user_id = auth.uid()
    )
    or public.is_org_member(public.org_id_for_event(event_id))
  )
  with check (
    public.is_org_member(public.org_id_for_event(event_id))
    or status = 'cancelled'
  );

-- Also missing indexes for columns this plan actually queries on ("My
-- Events", the event detail page, admin team assembly).
create index event_registrations_user_idx on event_registrations (user_id);
create index event_registrations_team_idx on event_registrations (team_id);
create index event_team_members_user_idx on event_team_members (user_id);
create index event_teams_captain_idx on event_teams (captain_user_id);
