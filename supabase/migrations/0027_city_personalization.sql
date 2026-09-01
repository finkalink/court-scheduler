-- City-scoped signup personalization
-- (docs/superpowers/specs/2026-09-01-city-scoped-signup-personalization-design.md).
--
-- default_city is free text, not an FK/enum -- it must match one of the
-- currently-active `locations.city` values, and that set changes as clubs
-- open and close, so it's validated in the app (isKnownCity,
-- src/lib/cityGrouping.ts) rather than as a DB check constraint. A stale
-- value (the city's last club later closes) is handled gracefully at read
-- time (resolveHomeCity falls through to the full list), not cleaned up
-- here -- same "no backfill" convention as slot_size_minutes, the
-- geocoding columns, etc.
--
-- city_prompt_dismissed tracks a permanent skip of the one-time "pick your
-- city" prompt shown at first login (src/app/choose-city/page.tsx) -- once
-- true, the prompt never reappears; the player can still set a city later
-- from /profile.
--
-- Neither column is identity-sensitive, so neither needs to be added to
-- the users_protect_identity_columns trigger (0023_protect_users_identity_columns.sql).
-- No RLS changes needed -- "users update own" (0002_rls.sql) already
-- covers both.

alter table users add column default_city text;
alter table users add column city_prompt_dismissed boolean not null default false;
