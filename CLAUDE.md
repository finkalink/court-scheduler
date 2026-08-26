\# Court Scheduler — Project Spec



\## What this is



A multi-tenant court booking platform, starting with volleyball, built to eventually support leagues, tournaments, and pickup/open-play events. 



Two user types from day one:



\- \*\*Org admins\*\* — companies/facilities that own courts and configure availability  

\- \*\*Players\*\* — book open time slots on those courts



\## Build order (do not skip ahead)



1\. \*\*v1 — Single court, single org, time-slot booking\*\* (current phase)  

2\. v2 — Multiple locations/courts per org, multiple orgs (full marketplace)  

3\. v3 — Payments (Stripe Connect)  

4\. v4 — Open-play / pickup event sign-ups (roster-based, not slot-based)  

5\. v5 — Leagues and tournament brackets



Build each phase fully before starting the next. Don't build ahead speculatively — but the data model below is already shaped to support later phases without a rewrite.



\## Tech stack



\- \*\*Frontend:\*\* Next.js (React) \\+ Tailwind CSS  

\- \*\*Backend/DB:\*\* Supabase (Postgres, Auth, Row-Level Security, Realtime)  

\- \*\*Hosting:\*\* Vercel  

\- \*\*Payments (phase 3+):\*\* Stripe Connect (platform takes a cut, orgs get payouts)


\## UI notes

\- Mobile-first — players will primarily book from their phone

\- Web-secondary — players may book from website on computer


\## Data model (target shape — build incrementally)



organizations (



&#x20; id, name, owner\\\_user\\\_id, stripe\\\_account\\\_id, created\\\_at



)



org\\\_members (



&#x20; org\\\_id, user\\\_id, role  \\-- 'owner' | 'admin' | 'staff'



)



locations (



&#x20; id, org\\\_id, name, address, timezone



)



courts (



&#x20; id, location\\\_id, name, surface\\\_type, is\\\_active



)



availability\\\_rules (



&#x20; id, court\\\_id, day\\\_of\\\_week, open\\\_time, close\\\_time



&#x20; \\-- recurring weekly template, e.g. "Mondays 6am-10pm"



)



slot\\\_overrides (



&#x20; id, court\\\_id, date, is\\\_closed, custom\\\_open, custom\\\_close



&#x20; \\-- one-off exceptions: holidays, maintenance, special hours



)



bookings (



&#x20; id, court\\\_id, user\\\_id, start\\\_time, end\\\_time, status, price, created\\\_at



)



users (



&#x20; id, name, email, phone, role  \\-- 'player' | 'org\\\_admin'



)



\*\*Key design decisions:\*\*



\- Bookable slots are computed on the fly from `availability\_rules` \\+ `slot\_overrides` \\+ existing `bookings` — we do NOT pre-generate a row for every possible hour. Availability \\= rule, minus overrides, minus existing bookings.  

\- `org\_members` is separate from `organizations.owner\_user\_id` so an org can have staff managing the calendar without full ownership/payout access.  

\- Hierarchy `organizations → locations → courts` is already shaped for the v2 marketplace and v5 leagues (a league just references a set of courts).



\## v1 scope specifically (build this first)



\- One org, one location, one court (hardcode is fine initially, but build against the real schema — don't build a single-court special case).  

\- Org admin can set weekly `availability\_rules` for the court.  

\- Player-facing calendar view shows open slots computed from rules minus existing bookings.  

\- Player can book an open slot (no payment yet — just creates a `bookings` row).  

\- No `slot\_overrides` UI needed yet, but the table should exist so we're not migrating later.  

\- Auth via Supabase Auth, email/password.  

\- Role-gate: `/admin` routes require `org\_members` role; everything else is player-facing.



\## Conventions



\- Use Supabase Row-Level Security from the start, not as an afterthought — org\\\_admins can only read/write their own org's data; players can only read/write their own bookings.  

\- All timestamps stored in UTC; convert to `locations.timezone` for display.  

\- Prefer server components / API routes for anything touching booking writes, to avoid race conditions on double-booking (check-then-insert should be a single transaction or use a Postgres constraint/exclusion range to prevent overlapping bookings on the same court).  

\- \*\*Auth: email/password\*\* (via Supabase Auth) for v1, with Google and Apple OAuth as fast-follows once core booking flow works.



\## Double-booking prevention (critical — do not rely on app-level checks alone)



App-level "check if slot is free, then insert" is a race condition: two players can pass the check at the same instant and both get booked. The fix is a database-level exclusion constraint that makes overlapping bookings on the same court physically impossible to insert, regardless of race conditions.



Requires the `btree\_gist` extension (once, in a migration):



create extension if not exists btree\\\_gist;



`bookings` table needs a `tstzrange` column (or generate one) and the constraint:



create table bookings (



&#x20; id uuid primary key default gen\\\_random\\\_uuid(),



&#x20; court\\\_id uuid not null references courts(id),



&#x20; user\\\_id uuid not null references users(id),



&#x20; start\\\_time timestamptz not null,



&#x20; end\\\_time timestamptz not null,



&#x20; status text not null default 'confirmed', \\-- 'confirmed' | 'cancelled'



&#x20; price numeric,



&#x20; created\\\_at timestamptz not null default now(),



&#x20; \\-- prevents overlapping bookings for the same court, but only among



&#x20; \\-- bookings that are still 'confirmed' (cancelled ones don't block)



&#x20; exclude using gist (



&#x20;   court\\\_id with \\=,



&#x20;   tstzrange(start\\\_time, end\\\_time) with \&\&



&#x20; ) where (status \\= 'confirmed')



);



What this does: any `insert` that would overlap an existing `confirmed` booking on the same `court\_id` is rejected by Postgres itself, atomically, no matter how many requests hit at once. The app just needs to catch the resulting error (Postgres error code `23P01`, exclusion violation) and show the user "that slot was just taken."



This means the booking insert doesn't need a transaction wrapping a manual check — the constraint IS the check.



\## Status log



\*(Update this section as we build — what's done, what's in progress, known issues.)\*



\- \[x] Supabase project created, schema migrated  

\- \[x] Auth wired up  

\- \[x] Admin: set availability for a court  

\- \[x] Player: view open slots  

\- \[x] Player: book a slot  

\- \[ ] Deploy to Vercel

\- \[x] Concurrency verified: two simultaneous overlapping inserts (identical range, then partial overlap) against the same court both hit the DB directly — one got `201`, the other was rejected with `23P01` in both cases. The exclusion constraint is doing its job independent of the app layer.

\- \[x] Player: view all of their own bookings (`/bookings` page)

\- \[x] Booking start times offered every 15 minutes, rolling (not just on the hour) — bookings themselves stay 60 minutes long; only the offered *start* granularity changed. `computeOpenSlots` takes separate `durationMinutes` (default 60) and `stepMinutes` (default 15) now.

\- \[x] Time-selection UI: player-facing slot grid groups the (now much denser) 15-min-step slots into collapsible per-hour sections (native `<details>`, no JS needed) instead of one flat button grid.

\- Known follow-up: the initial RLS policies on `locations`/`courts`/`availability\_rules`/`slot\_overrides` required `authenticated`, which silently hid the court from anonymous visitors. Fixed in `supabase/migrations/0003\_public\_read.sql` — these are non-sensitive facility fields, readable by `anon`.

