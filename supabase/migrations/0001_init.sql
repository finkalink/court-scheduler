-- Extensions
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- organizations
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid, -- nullable: set once the owning user has signed up (see seed.sql bootstrap note)
  stripe_account_id text,
  created_at timestamptz not null default now()
);

-- org_members: separate from organizations.owner_user_id so an org can have
-- staff managing the calendar without full ownership/payout access.
create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  primary key (org_id, user_id)
);

-- locations
create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address text,
  timezone text not null default 'UTC'
);

-- courts
create table courts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  name text not null,
  surface_type text,
  is_active boolean not null default true
);

-- availability_rules: recurring weekly template, e.g. "Mondays 6am-10pm"
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  open_time time not null,
  close_time time not null,
  check (open_time < close_time)
);

-- slot_overrides: one-off exceptions (holidays, maintenance, special hours).
-- No UI yet in v1, but the table exists so we're not migrating later.
create table slot_overrides (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id) on delete cascade,
  date date not null,
  is_closed boolean not null default false,
  custom_open time,
  custom_close time
);

-- users: profile table separate from auth.users (which Supabase Auth owns).
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text not null,
  phone text,
  role text not null default 'player' check (role in ('player', 'org_admin')),
  created_at timestamptz not null default now()
);

-- bookings
create table bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id),
  user_id uuid not null references users(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  price numeric,
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  -- Prevents overlapping bookings for the same court, but only among
  -- bookings that are still 'confirmed' (cancelled ones don't block).
  -- This constraint IS the concurrency check: Postgres rejects any insert
  -- that would overlap an existing confirmed booking, atomically, no matter
  -- how many requests hit at once. The app catches error code 23P01.
  exclude using gist (
    court_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status = 'confirmed')
);

-- Trigger: create a public.users profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Scalability indexes
create index bookings_court_start_idx on bookings (court_id, start_time);
create index org_members_user_org_idx on org_members (user_id, org_id);
create index availability_rules_court_day_idx on availability_rules (court_id, day_of_week);
create index slot_overrides_court_date_idx on slot_overrides (court_id, date);
create index courts_location_idx on courts (location_id);
create index locations_org_idx on locations (org_id);
