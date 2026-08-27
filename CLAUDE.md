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

\- \[x] Deploy to Vercel — live at https://court-scheduler-gold.vercel.app. Note: the Vercel project was originally connected before any app code existed in the repo, so it auto-detected Framework Preset as "Other" and never re-detected on later pushes (silently served static output instead of the Next.js app — 404 on every route despite "successful" builds). Fixed by manually setting Framework Preset to "Next.js" in Project Settings → General.

\- \[x] Concurrency verified: two simultaneous overlapping inserts (identical range, then partial overlap) against the same court both hit the DB directly — one got `201`, the other was rejected with `23P01` in both cases. The exclusion constraint is doing its job independent of the app layer.

\- \[x] Player: view all of their own bookings (`/bookings` page)

\- \[x] Booking start times offered every 15 minutes, rolling (not just on the hour) — bookings themselves stay 60 minutes long; only the offered *start* granularity changed. `computeOpenSlots` takes separate `durationMinutes` (default 60) and `stepMinutes` (default 15) now.

\- \[x] Time-selection UI, v1: player-facing slot grid grouped the (then much denser) 15-min-step slots into collapsible per-hour sections (native `<details>`, no JS needed) instead of one flat button grid. Superseded below.

\- \[x] Time-selection UI, v2: replaced the collapsible 15\\-min\\-step sections with a flat grid of on\\-the\\-hour blocks (`computeOpenSlots` now called with `stepMinutes: 60`, matching the existing 60\\-min `durationMinutes`) and a new client component, `TimeBlockPicker` (`src/app/locations/\[locationId]/courts/\[courtId]/TimeBlockPicker.tsx` \\-\\- the app's first `"use client"` component), that lets a player click through one or more \\*adjacent\\* hour blocks before hitting "Continue". Clicking extends the selection in whichever direction the new click falls; clicking across a gap (an already\\-booked hour breaks the chain) resets the selection to just that block. The merged range is passed to the existing `/book` confirm page exactly as before (`start`/`end` query params), so `createBooking` needed no changes \\-\\- a 3\\-block selection just books one longer booking. Block size itself is per\\-court, not hardcoded \\-\\- see the entry below.

\- \[x] Date display cleanup: dates shown to players/admins (the day being browsed, a booking's date, the confirm\\-page summary) now read like "Wednesday, 8/26/2026" instead of the previous mix of a raw `yyyy\\-MM\\-dd` string and abbreviated `"EEE, MMM d"` labels. New shared helpers in `src/lib/dateFormat.ts` \\-\\- `formatBookingDate` (real instants, formatted in the location's timezone) and `formatCalendarDate` (plain `YYYY\\-MM\\-DD` calendar dates, formatted via the same noon\\-UTC trick `availability.ts` already used for day\\-of\\-week lookups, so it can't shift across a date boundary).

\- All 3 seeded courts had their weekly availability set to 9am\\-11pm every day via a one\\-off script (run directly against Supabase with the service\\-role key, not committed) for easier testing of the new picker.

\- Known follow-up: the initial RLS policies on `locations`/`courts`/`availability\_rules`/`slot\_overrides` required `authenticated`, which silently hid the court from anonymous visitors. Fixed in `supabase/migrations/0003\_public\_read.sql` — these are non-sensitive facility fields, readable by `anon`.

\- \[x] v2: Player-facing directory \\-\\- home page (`/`) lists all locations with an active court across every org, drilling into `/locations/\[locationId]` then `/locations/\[locationId]/courts/\[courtId]` for the booking calendar (previously hardcoded to the one seeded court via `.limit(1).single()`).

\- \[x] v2: Admin can manage multiple locations and courts within their org \\-\\- `/admin` is now an org dashboard (list locations, add a location), `/admin/locations/\[locationId]` lists/adds courts and toggles `is\_active`, `/admin/locations/\[locationId]/courts/\[courtId]` is the per-court weekly availability editor (previously hardcoded to the one seeded court). New actions `createLocation`, `createCourt`, `updateCourtActive` in `src/app/admin/actions.ts`; authorization is enforced entirely by the existing RLS policies from `0002\_rls.sql`, no new app-level checks needed.

\- \[x] v2: No schema/RLS changes were needed for the org/location/court hierarchy itself \\-\\- confirms the v1 design note that it was already shaped for this. One RLS gap was found and fixed: `organizations` was still member-only readable (`0002\_rls.sql`), which silently blank\\-ed the org name once the player UI started embedding it through `locations`. Fixed the same way as the v1 courts/locations gap, in `supabase/migrations/0004\_public\_org\_read.sql`.

\- \[x] `supabase/migrations/0004\_public\_org\_read.sql` applied to the live Supabase project and the full v2 admin CRUD flow (add location \\-\\> add court \\-\\> set availability \\-\\> toggle active) manually verified by the user, logged in.

\- \[x] Court notes: optional free-text `courts.notes` field (`supabase/migrations/0005\_court\_notes.sql`), editable per-court in `/admin/locations/\[locationId]` alongside the active/inactive toggle, shown to players on the court's booking page when set.

\- \[x] Booking configuration requests: players can optionally request a net height (men's/women's) and court lines (4s/6s) when booking \\-\\- volleyball-specific, matches the sport this app currently serves. Booking is now a two-step flow: the slot grid at `/locations/\[locationId]/courts/\[courtId]` links to a confirm page at `.../book` (new) with the two selects, which posts to `createBooking`. Requested config is stored on `bookings` (`supabase/migrations/0006\_booking\_configuration.sql`, nullable columns, no RLS change needed) and shown back to the player on `/bookings` and to the court's admin on `/admin/locations/\[locationId]/courts/\[courtId]` under a new "Upcoming bookings" section (time + requested config only, no player identity \\-\\- there's still no admin view of *who* booked, deliberately, since that would need a new RLS-visible path into player profiles that wasn't asked for). Shared option lists/formatting in `src/lib/courtConfig.ts`.

\- \[x] Location timezone is now a real `<select>` (all IANA zones via `Intl.supportedValuesOf("timeZone")`) instead of a free-text input, on the "Add a location" form in `/admin`.

\- \[x] `supabase/migrations/0006\_booking\_configuration.sql` applied to the live Supabase project; booking configuration requests verified end-to-end (player request \\-\\> stored \\-\\> shown to player and admin).

\- Additional-organizations support (self-serve club setup \\+ admin-assisted creation with ownership transfer to a user) is spec'd but explicitly deferred by the user \\-\\- see the `v2-org-creation-deferred` memory for the full two-path spec and the RLS/platform-admin considerations it'll need.

\- Org onboarding is still manual/SQL in v2 (no self\\-serve org signup), and an admin belonging to multiple orgs still lands on their first membership \\-\\- both deliberate scope cuts, not gaps.

\- \[x] Booking cancellation \\-\\- new shared `cancelBooking` action (`src/app/actions/bookings.ts`) sets `status = 'cancelled'`; no schema change needed since the exclusion constraint already only applies `where (status = 'confirmed')`, and RLS's existing `bookings update own or member` policy is what actually decides who's allowed to cancel which row \\-\\- the action itself does no ownership check. Wired up as a "Cancel" button on the player's own confirmed bookings at `/bookings`, and on each upcoming booking in the admin court view at `/admin/locations/\[locationId]/courts/\[courtId]`.

\- \[x] Admin booking modification \\-\\- admins can now edit a booking's requested net height / court lines (new `updateBookingConfig` action in `src/app/admin/actions.ts`) directly from the "Upcoming bookings" list on the admin court page, in addition to cancelling it. Still no admin visibility into *who* booked (unchanged, deliberate).

\- Typecheck (`tsc --noEmit`) is clean for both of the above and the admin court page loads without server errors, but the full click\\-through (sign up \\-\\> confirm email \\-\\> book \\-\\> cancel as a player; edit/cancel as an admin) hasn't been manually verified yet \\-\\- the sandboxed browser used for testing can't follow the Supabase email\\-confirmation link (blocked from navigating to a new external domain), so live verification is pending a manual pass.

\- \[x] Per\\-court booking block size: an org owner sets a court to "Full hour" or "Half hour" blocks when adding it, on the "Add a court" form in `/admin/locations/\[locationId]`; existing courts show their current setting alongside Active/Inactive but the setting isn't editable after creation yet (not asked for). New `courts.slot\_size\_minutes` column (`supabase/migrations/0007\_court\_slot\_size.sql`, smallint, default 60, check in (30, 60) \\-\\- default keeps existing courts on today's full\\-hour behavior with no backfill needed). The player booking page now calls `computeOpenSlots` with `durationMinutes`/`stepMinutes` both set to the court's `slot_size_minutes` instead of a hardcoded 60, so `TimeBlockPicker` automatically renders 30\\-min blocks (e.g. "9:30 AM") for a half\\-hour court with no picker changes needed.

\- \[x] `supabase/migrations/0007\_court\_slot\_size.sql` applied to the live Supabase project by the user (run manually via the Supabase SQL editor \\-\\- Claude couldn't run it directly, no DB connection string or `supabase login` token available in this environment). Verified end\\-to\\-end: added a half\\-hour test court, set its weekly availability, and confirmed the player booking page renders 30\\-min blocks (9:00, 9:30, 10:00, ...) instead of hourly ones. Test court deactivated afterward (no delete\\-court UI exists yet, so it still shows, inactive, in the admin courts list until one is built or it's removed directly in the database).

\- \[ ] Location admin page to manage sites and times \\-\\- a page for admins to manage a location's (site's) own settings and hours, distinct from the existing per\\-court availability editor at `/admin/locations/\[locationId]/courts/\[courtId]`.

\- \[x] Role\\-based navigation sidebar \\-\\- new `AppShell` client component (`src/components/AppShell.tsx`), rendered from the root layout for every route, replaces every page's ad\\-hoc header (My bookings/email, the old "Player view" admin header, the one\\-off `AdminSwitchLink` stopgap from earlier the same session). Docked on desktop, collapses into a hamburger\\-triggered slide\\-over drawer on mobile (no icon library added \\-\\- reuses the existing plain\\-text\\-arrow convention). Nav differs by whether you're signed in and whether you're an org member \\-\\- not by `org\_members.role`, since role still isn't used to gate anything anywhere in the app.

\- \[x] General navigation / post\\-login landing per user type \\-\\- org members now land on `/admin` after signing in (instead of the player home page); an explicit `next` redirect (e.g. a deep link that bounced through `/login`) still takes priority. Change lives in `signIn` (`src/app/actions/auth.ts`) and the login form's hidden `next` field.

\- \[ ] Email confirmations for bookings and cancellations \\-\\- no transactional email is sent today on booking create or cancel. Will need an email provider decision (Supabase Auth's built\\-in email is for auth flows only, not transactional app email).

\- \[ ] Availability reconfiguration \\-\\- rework `availability\_rules` from a single open/close block per day into: an admin sets general open hours for the day, then can individually block or re\\-enable specific 30\\-min slots within that window (rather than the whole window being uniformly open). Needs a data model change \\-\\- likely a new per\\-court, per\\-slot table (extending or alongside `slot\_overrides`, which currently only does whole\\-day closures or a single custom open/close override, not per\\-slot granularity) \\-\\- and a corresponding change to `computeOpenSlots` in `src/lib/availability.ts` to also exclude explicitly\\-blocked slots.

\- \[x] Save confirmation messages: every admin mutation that previously gave no visible feedback (the form just re\\-rendered with the same-looking values, so it wasn't obvious a save had worked) now redirects back to itself with a query\\-param flag and shows a small green confirmation \\-\\- "Notes saved.", "Court activated."/"Court deactivated.", "Availability saved.", "Location added.", "Court added.", and a per\\-booking "Saved." for the admin's net\\-height/court\\-lines edit. Player and admin booking cancellation both now show "Booking cancelled." too, even though the status badge/disappearing row already made that fairly obvious. New shared `SuccessBanner` component (`src/components/SuccessBanner.tsx`) for the full\\-width ones; the per\\-court/per\\-booking ones (`notes\_saved`, `active\_changed`, `config\_saved` \\-\\- keyed by that row's id since a page can list several) are small inline text instead so it's clear which item was affected. Same pattern as the pre\\-existing `booked=1` confirmation on the court page \\-\\- a redirect\\-borne query param, not a JS toast \\-\\- so it stays consistent with the rest of the app and needed no new client components. `cancelBooking` gained a `redirect_to` field since it's called from two different pages that need to land back in different places.

\- \[x] Court details are now editable after creation \\-\\- an "Edit court" disclosure (native `<details>`, no JS) under each court in `/admin/locations/\[locationId]` opens a form for name, surface type, booking block size, and notes, all saved together by one new `updateCourt` action (`src/app/admin/actions.ts`), which replaces the earlier notes\\-only `updateCourtNotes`. Supersedes the "not editable after creation yet (not asked for)" note on the block\\-size entry above.

\- \[x] Location details (name, address, timezone) are also now editable after creation, same pattern as the court edit above \\-\\- an "Edit location" disclosure at the top of `/admin/locations/\[locationId]`, one new `updateLocation` action (`src/app/admin/actions.ts`). Timezone edits use `revalidatePath(\`/locations/${locationId}\`, "layout")` rather than listing every court subpage individually, since changing a location's timezone affects every court booking page under it.

\- \[ ] Dedicated booking confirmation page \\-\\- after `createBooking` succeeds, replace the current `?booked=1` banner on the court page with a real confirmation page (own route, e.g. `/bookings/\[bookingId]` or similar) showing the booking's date/time/court/requested config back to the player. Future, on that same page: "Add to calendar" across the popular options (Google Calendar, Apple Calendar, Outlook, and a downloadable `.ics` as the generic fallback) so a player can get the reservation onto their own calendar. Ties into the existing "Email confirmations for bookings and cancellations" backlog item above \\-\\- an emailed confirmation would want the same calendar\\-add links/attachment.

