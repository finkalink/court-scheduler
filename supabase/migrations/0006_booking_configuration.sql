-- Optional player-requested court configuration at booking time (volleyball-
-- specific: net height and boundary lines). Nullable -- no default, most
-- bookings won't set a preference. RLS unchanged: the existing
-- "bookings insert own" / "bookings select org member" policies from
-- 0002_rls.sql already cover any column on this table.
alter table bookings
  add column requested_net_height text check (requested_net_height in ('mens', 'womens')),
  add column requested_court_lines text check (requested_court_lines in ('4s', '6s'));
