-- User profiles. users.name already existed (0001_init.sql) but was
-- never written to by any code path. Adds gender and skill_level so a
-- real profile exists to gate non-open_play event registration on (see
-- registerForEvent in src/app/actions/events.ts) and to serve as a
-- default display name. No RLS changes needed -- "users select own"/
-- "users update own" (0002_rls.sql) already cover a player reading and
-- editing their own profile row.

alter table users add column gender text
  check (gender in ('male', 'female', 'prefer_not_to_say'));
alter table users add column skill_level text
  check (skill_level in ('Recreational', 'B', 'BB', 'A', 'AA', 'Open'));
