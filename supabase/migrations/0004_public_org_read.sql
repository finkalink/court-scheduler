-- v2: the player-facing directory (home page, location page, bookings page)
-- now embeds organizations.name through locations/courts, e.g.
--   .from("locations").select("..., organization:organizations(name)")
-- The original "organizations select member" policy from 0002_rls.sql only
-- allows org members to read a row -- same silent-empty-result bug already
-- fixed for locations/courts/availability_rules/slot_overrides in
-- 0003_public_read.sql, just discovered here because v2 is the first place
-- the app reads organizations as an unauthenticated player.
--
-- organizations.name is non-sensitive facility branding, same category as
-- location/court names already opened up. owner_user_id and
-- stripe_account_id become technically public-readable too, but neither is
-- a secret (a UUID pointing at a user; a Stripe *account* id, not a key) and
-- stripe_account_id is unpopulated until v3 (Stripe Connect) anyway.
-- Revisit with a narrower view (same pattern as booked_slots) if/when v3
-- payments makes that column worth hiding.

drop policy "organizations select member" on organizations;
create policy "organizations select all" on organizations
  for select using (true);
