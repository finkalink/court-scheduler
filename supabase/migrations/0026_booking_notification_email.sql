-- cancelBooking is called from two different pages: a player cancelling
-- their own booking, and an org admin cancelling a player's booking on
-- their behalf. Either way, the cancellation email needs to go to the
-- booking's *owner*, who may not be the caller -- and `users` RLS ("users
-- select own") only lets someone read their own row. Same gap and same
-- fix as list_org_member_emails (0011): a narrow security-definer
-- function, gated by the exact same condition as the existing "bookings
-- update own or member" RLS policy (0002) that already decides who's
-- allowed to cancel this booking in the first place.
create function public.get_booking_notification_email(target_booking_id uuid)
returns table(email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.email
  from bookings b
  join users u on u.id = b.user_id
  where b.id = target_booking_id
    and (
      b.user_id = auth.uid()
      or public.is_org_member(public.org_id_for_court(b.court_id))
    );
$$;

grant execute on function public.get_booking_notification_email(uuid) to authenticated;
