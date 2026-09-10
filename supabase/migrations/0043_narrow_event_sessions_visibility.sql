-- Residual gap flagged (not fixed) by 0034: "events select all" was narrowed
-- to hide a deactivated org's events, but "event_sessions select all"
-- (0015) stayed `using (true)` -- a direct anon query against
-- event_sessions as a base table would still return a deactivated org's
-- session start/end times and court id. Same narrowing, same shape as
-- 0034's fix to events, reusing org_id_for_court (0002) since
-- event_sessions has a court_id, not a location_id.
drop policy "event_sessions select all" on event_sessions;
create policy "event_sessions select all" on event_sessions
  for select using (
    public.is_org_member(public.org_id_for_court(court_id))
    or public.is_platform_admin()
    or exists (
      select 1 from organizations o
      where o.id = public.org_id_for_court(court_id) and o.is_active
    )
  );
