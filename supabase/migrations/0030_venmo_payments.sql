-- Manual Venmo payments for event registration -- see
-- docs/superpowers/specs/2026-09-05-venmo-manual-payments-design.md.
-- event_registrations.payment_status has existed unused since
-- 0017_event_registration.sql; this is the first thing to read or write
-- it. Both new columns are nullable with no backfill, matching every
-- other optional column added to these tables.

alter table organizations add column venmo_handle text;
alter table events add column fee_cents integer;

-- Needed so markRegistrationPaid (src/app/admin/eventActions.ts) can
-- email the registrant a payment confirmation -- users' own RLS ("users
-- select own") doesn't let an org member read another user's email
-- directly. Same pattern as get_booking_notification_email (0026):
-- gated by the exact condition event_registrations' own update policy
-- already uses ("event_registrations update own or captain or member"),
-- so this doesn't expose anything the caller couldn't already act on.
-- Resolves to the individual registrant's email, or the team captain's
-- for a team registration -- the captain is the one who pays, per the
-- flat-fee decision.
create function public.get_registration_notification_email(p_registration_id uuid)
returns table(email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.email
  from event_registrations r
  join users u on u.id = coalesce(
    r.user_id,
    (select t.captain_user_id from event_teams t where t.id = r.team_id)
  )
  where r.id = p_registration_id
    and public.is_org_member(public.org_id_for_event(r.event_id));
$$;

grant execute on function public.get_registration_notification_email(uuid) to authenticated;
