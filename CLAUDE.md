# Court Scheduler — Project Spec

Multi-tenant court booking platform, starting with volleyball, built toward leagues/tournaments/open-play. Two user types from day one: **org admins** (own courts, configure availability) and **players** (book open slots).

Full build history / status log: [docs/STATUS.md](docs/STATUS.md). Update it as work lands — this file stays spec + rules only.

## Stack

- **Frontend:** Next.js (React) + Tailwind CSS
- **Backend/DB:** Supabase (Postgres, Auth, RLS, Realtime)
- **Hosting:** Vercel
- **Payments (v4):** Stripe Connect (platform cut, org payouts)
- **UI:** mobile-first (players book from phone), web-secondary

## Build order (do not skip ahead)

1. v1 — single court, single org — **shipped**
2. v2 — multi-location/multi-court, multi-org marketplace — **shipped**
3. **v3 — Special Events (current): tournaments, leagues, open play, clinics.** Spec: `docs/superpowers/specs/2026-08-30-special-events-design.md`. Sub-phases, each its own plan: (a) core events/sessions/court-blocking — shipped, (b) registration/teams/waitlist — shipped, (c) brackets — shipped. Paid registration waits on v4; events are free/RSVP-only until then.
4. v4 — Payments (Stripe Connect) — not started

Build each phase fully before starting the next. Data model below is already shaped for later phases — no rewrite needed.

## Data model (original target shape — schema has since grown; see migrations for current truth)

```
organizations(id, name, owner_user_id, stripe_account_id, created_at)
org_members(org_id, user_id, role)                    -- 'owner' | 'admin' | 'staff'
locations(id, org_id, name, address, timezone)
courts(id, location_id, name, surface_type, is_active)
availability_rules(id, court_id, day_of_week, open_time, close_time)   -- weekly template
slot_overrides(id, court_id, date, is_closed, custom_open, custom_close)  -- one-off exceptions
bookings(id, court_id, user_id, start_time, end_time, status, price, created_at)
users(id, name, email, phone, role)                   -- 'player' | 'org_admin'
```

Key decisions:
- Open slots are computed on the fly (`availability_rules` − `slot_overrides` − existing `bookings`) — never pre-generated.
- `org_members` is separate from `organizations.owner_user_id` so staff can manage the calendar without ownership/payout access.
- `organizations → locations → courts` hierarchy is already shaped for the marketplace and leagues (a league just references a set of courts).

## Conventions

- **RLS from the start**, never bolted on later: org admins read/write only their own org's data; players read/write only their own bookings.
- All timestamps stored UTC; convert to `locations.timezone` for display.
- Booking writes go through server components/API routes, never client-side — race safety comes from the DB constraint below, not app logic.
- **Auth:** Supabase email/password now; Google + Apple OAuth are planned fast-follows.
- **TDD:** write a failing test first, show it, then implement until it passes; run `npm test` after each change. `vitest` + React Testing Library (`vitest.config.mts`, jsdom). `npm test` runs once, `npm run test:watch` stays open. Component/interaction bugs are tested through RTL against the real component — don't extract logic into a pure function just to make it easier to test.

## Double-booking prevention (critical — DB-level, not app-level)

App-level "check if free, then insert" is a race condition. Fix: a Postgres exclusion constraint makes overlapping `confirmed` bookings on the same court physically impossible to insert.

```sql
create extension if not exists btree_gist;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id),
  user_id uuid not null references users(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'confirmed',  -- 'confirmed' | 'cancelled'
  price numeric,
  created_at timestamptz not null default now(),
  exclude using gist (
    court_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status = 'confirmed')             -- cancelled bookings don't block
);
```

The app catches the resulting error (Postgres `23P01`, exclusion violation) and shows "that slot was just taken." No transaction wrapping a manual check is needed — the constraint *is* the check.
