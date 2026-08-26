-- v1 seed: exactly one organization, one location, one court.
-- Run once against a fresh database (Supabase SQL editor or `supabase db reset`,
-- which runs this automatically after migrations).

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Ace Volleyball Club');

insert into locations (id, org_id, name, address, timezone)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Main Facility',
  '123 Court St',
  'America/Los_Angeles'
);

insert into courts (id, location_id, name, surface_type, is_active)
values (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  'Court 1',
  'indoor hardwood',
  true
);

-- ---------------------------------------------------------------------------
-- ONE-TIME MANUAL BOOTSTRAP (not run by this file):
-- organizations.owner_user_id can't be set until a real user exists. After
-- you sign up your first (admin) account through the app, run this once in
-- the Supabase SQL editor, substituting that user's auth.users id:
--
--   update organizations set owner_user_id = '<your-user-id>'
--     where id = '00000000-0000-0000-0000-000000000001';
--
--   insert into org_members (org_id, user_id, role)
--     values ('00000000-0000-0000-0000-000000000001', '<your-user-id>', 'owner');
-- ---------------------------------------------------------------------------
