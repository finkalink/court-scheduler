-- Fix: the player-facing calendar must be browsable before login (only
-- booking and admin should require auth). The original policies required
-- auth.role() = 'authenticated' for locations/courts/availability_rules/
-- slot_overrides, which silently returned zero rows to anonymous visitors
-- instead of erroring -- this is what made the home page show "no court
-- has been set up" even after the schema and seed were in place.
-- None of this data is sensitive (facility name, hours, court name), so
-- open it to anon reads too.

drop policy "locations select all" on locations;
create policy "locations select all" on locations
  for select using (true);

drop policy "courts select all" on courts;
create policy "courts select all" on courts
  for select using (true);

drop policy "availability_rules select all" on availability_rules;
create policy "availability_rules select all" on availability_rules
  for select using (true);

drop policy "slot_overrides select all" on slot_overrides;
create policy "slot_overrides select all" on slot_overrides
  for select using (true);

-- booked_slots (start/end times only, no user identity or price) should
-- also be visible pre-login so the calendar shows accurate availability
-- before a player is prompted to sign in to actually book.
grant select on booked_slots to anon;
