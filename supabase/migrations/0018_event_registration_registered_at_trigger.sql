-- Fixes a gap found in review of 0017_event_registration.sql: a column
-- DEFAULT only applies when the column is omitted from an insert, not
-- when the client explicitly supplies a value -- so nothing stopped a
-- self-registering caller from fabricating an earlier registered_at to
-- jump ahead in promote_next_waitlisted's FIFO ordering. Force it
-- server-side regardless of what the client supplies.
create function public.set_event_registration_registered_at()
returns trigger
language plpgsql
as $$
begin
  new.registered_at := now();
  return new;
end;
$$;

create trigger event_registrations_set_registered_at
  before insert on event_registrations
  for each row execute procedure public.set_event_registration_registered_at();
