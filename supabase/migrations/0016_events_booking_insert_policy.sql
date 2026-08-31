-- Fixes a gap found in review of 0015_events_core.sql: no RLS policy
-- permitted inserting a source='event' bookings row (the existing
-- "bookings insert own" policy requires user_id = auth.uid(), which a
-- NULL-user_id event row can never satisfy). Org members can insert an
-- event-sourced booking for their own org's courts.
create policy "bookings insert event member" on bookings
  for insert with check (
    source = 'event' and public.is_org_member(public.org_id_for_court(court_id))
  );
