-- Per-court booking block size: whether players pick from full-hour or
-- half-hour blocks on the booking calendar. Defaults to 60 (today's only
-- behavior) so existing courts are unaffected.
alter table courts
  add column slot_size_minutes smallint not null default 60
    check (slot_size_minutes in (30, 60));
