-- Per-tournament match scoring config: how many sets are played and what a
-- set win requires. Nullable-with-sensible-defaults, matching every other
-- optional-config column added to events (fee_cents, etc) -- existing
-- events get the same defaults an admin would pick for a typical volleyball
-- set (best of 3, first to 21, win by 2) with no backfill needed.
alter table events add column best_of_sets integer not null default 3 check (best_of_sets between 1 and 5);
alter table events add column points_per_set integer not null default 21 check (points_per_set > 0);
alter table events add column win_by integer not null default 2 check (win_by > 0);
