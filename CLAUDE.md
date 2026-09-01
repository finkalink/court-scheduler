\# Court Scheduler — Project Spec



\## What this is



A multi-tenant court booking platform, starting with volleyball, built to eventually support leagues, tournaments, and pickup/open-play events. 



Two user types from day one:



\- \*\*Org admins\*\* — companies/facilities that own courts and configure availability  

\- \*\*Players\*\* — book open time slots on those courts



\## Build order (do not skip ahead)



1\. v1 — Single court, single org, time-slot booking (shipped)

2\. v2 — Multiple locations/courts per org, multiple orgs (full marketplace) (shipped)

3\. \*\*v3 — Special Events: tournaments, leagues, open play, clinics\*\* (current phase) — reprioritized ahead of Payments on 2026\\-08\\-30; supersedes the original v4 (Open\\-play) and v5 (Leagues and tournament brackets) entries, consolidated into one design. See `docs/superpowers/specs/2026\\-08\\-30\\-special\\-events\\-design.md` for the full spec. Decomposes into: (a) core events/sessions/court\\-blocking, (b) registration/teams/waitlist, (c) brackets — each its own implementation plan, built and shipped independently. Payment integration for paid event registration waits on Payments below; events ship free/RSVP\\-only until then.

4\. v4 — Payments (Stripe Connect)



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

- **TDD workflow**: for a new function or a bug fix, write a failing test first, show it before implementing, then implement until it passes — run `npm test` after each change. `vitest` + React Testing Library (`vitest.config.mts`, jsdom environment); `npm test` runs once, `npm run test:watch` stays open. Component/interaction bugs (e.g. a click handler's selection logic) are tested through React Testing Library against the real component, not by extracting the logic into a separate pure function just to make it easier to test.



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

- [x] Superseded above: location admin hours page shipped, at `/admin/locations/[locationId]/hours` (linked from the location's courts page), plus per-court date overrides. Two pieces: (1) a "General Hours" form there is a template, not stored anywhere new -- submitting it does a plain GET to `/admin/locations/[locationId]/hours/confirm`, which lists every court at the location that will be overwritten and the hours that will be applied; "Apply to All Courts" (`pushHoursToAllCourts` in `src/app/admin/actions.ts`) then does the same delete-then-insert full-week-replace into each court's `availability_rules` that the existing per-court editor already did (that logic was pulled out into a shared `replaceAvailabilityRules` helper so both call sites stay in sync), while "Cancel" is a plain link back with no write ever having happened. (2) the previously-unused `slot_overrides` table (one row per court per date -- closed, or custom open/close) now has a "Date Overrides" section on the per-court page: an add/edit form plus a list of upcoming overrides with Remove, backed by new `saveSlotOverride`/`deleteSlotOverride` actions. `saveSlotOverride` upserts on `(court_id, date)` -- previously nothing enforced one row per date, so `supabase/migrations/0009_slot_override_unique.sql` adds that unique constraint (applied to the live Supabase project via `npm run migrate`). Form validation (must be either "closed" or both custom times, not a partial pair, and open must be before close) is a small pure function, `validateSlotOverride` in `src/lib/slotOverride.ts`, built test-first per the TDD convention -- `src/lib/slotOverride.test.ts`. No role-gating was added (any org member can reach `/hours` today, same as the rest of `/admin`) -- a future "club owner" role restricting this page is deferred to the separate Club admins backlog item below. Manually verified end-to-end in the browser: pushed new hours to Main Facility's 2 courts via the confirm step, added a closed-day override, hit the validation error on a partial custom-hours submission, and removed the override -- then pushed the original 9am-11pm-daily hours back so the push doesn't leave the shared dev data changed.

\- \[x] Role\\-based navigation sidebar \\-\\- new `AppShell` client component (`src/components/AppShell.tsx`), rendered from the root layout for every route, replaces every page's ad\\-hoc header (My bookings/email, the old "Player view" admin header, the one\\-off `AdminSwitchLink` stopgap from earlier the same session). Docked on desktop, collapses into a hamburger\\-triggered slide\\-over drawer on mobile (no icon library added \\-\\- reuses the existing plain\\-text\\-arrow convention). Nav differs by whether you're signed in and whether you're an org member \\-\\- not by `org\_members.role`, since role still isn't used to gate anything anywhere in the app.

\- \[x] General navigation / post\\-login landing per user type \\-\\- org members now land on `/admin` after signing in (instead of the player home page); an explicit `next` redirect (e.g. a deep link that bounced through `/login`) still takes priority. Change lives in `signIn` (`src/app/actions/auth.ts`) and the login form's hidden `next` field.

\- \[ ] Email confirmations for bookings and cancellations \\-\\- no transactional email is sent today on booking create or cancel. Will need an email provider decision (Supabase Auth's built\\-in email is for auth flows only, not transactional app email).

\- \[ ] Availability reconfiguration \\-\\- rework `availability\_rules` from a single open/close block per day into: an admin sets general open hours for the day, then can individually block or re\\-enable specific 30\\-min slots within that window (rather than the whole window being uniformly open). Needs a data model change \\-\\- likely a new per\\-court, per\\-slot table (extending or alongside `slot\_overrides`, which currently only does whole\\-day closures or a single custom open/close override, not per\\-slot granularity) \\-\\- and a corresponding change to `computeOpenSlots` in `src/lib/availability.ts` to also exclude explicitly\\-blocked slots.

- [x] Superseded above: per-slot availability blocking shipped, both recurring (by day-of-week) and one-off (by specific date), sharing a single new `blocked_slots` table (`supabase/migrations/0014_blocked_slots.sql`) and a single new "Blocked Slots" admin UI section rather than two separate mechanisms -- a row's `day_of_week` XOR `date` decides which mode it belongs to. Block granularity always matches the court's own `slot_size_minutes` (not a hardcoded 30 minutes, since the backlog note's literal wording didn't account for 60-min courts). `computeOpenSlots` (`src/lib/availability.ts`) gained a `blockedSlots` param and now excludes any candidate whose wall-clock start matches a blocked entry for that day-of-week or exact date. A new shared `generateSlotStarts` helper backs the admin grid-builder (`buildSlotGrid` in `src/lib/blockedSlots.ts`); `computeOpenSlots` does not call it, since `generateSlotStarts`'s loop boundary is keyed on `stepMinutes` while `computeOpenSlots`'s is keyed on `durationMinutes` -- these only coincide when duration equals step, which isn't universal for `computeOpenSlots` (its own default params keep the two independently settable), so `computeOpenSlots` instead reimplements the equivalent wall-clock walk directly, via the same private helpers, rather than risk a silent misalignment in the blocked-slot check. Both were built test-first. The admin section (on the existing per-court page, alongside Weekly Availability and Date Overrides) uses a query-param-driven mode/day/date picker (no client component, matching this app's established convention) and a grid of small per-slot toggle forms, the same immediate-click feel as the player booking grid but without a shared client component, since blocks don't need contiguous-selection semantics. `blocked_slots` was made public-select (`using (true)`) from day one, learning from the earlier gap where `availability_rules`/`slot_overrides` needed a follow-up migration to fix exactly this. Blocking never touches existing bookings, matching how `slot_overrides.is_closed` already worked -- manually verified a slot with a live booking can be blocked without error or any change to the booking. Manually verified end-to-end: a recurring block affects every occurrence of that weekday and nothing else; a one-off date block affects only that exact date, including on a different weekday than a simultaneously-active recurring block; both unblock cleanly. Final-review fix wave on top: the player court page's `?date=` validation (added alongside the original blocking work) checked format but not calendar validity, so a rolled-over date like `2026-02-30` silently defeated blocking -- both the overrides and blocked-slots queries would fail against Postgres and their discarded errors left the page rendering a full-open grid; now validated via a round-trip through `Date` and back, not just the shape regex. Separately, `toggleBlockedSlot` (`src/app/admin/actions.ts`) now treats a `23505` unique-violation on insert (a stale double-click or two admins toggling the same slot at once) as a harmless no-op instead of throwing a raw 500, matching the existing convention in `createBooking`. Two related gaps were identified but deliberately deferred, not fixed, in that same pass: `createBooking` still does no server-side re-check that the requested time isn't blocked/closed before inserting (a pre-existing hole that predates this feature but is more consequential now that "hold this time free" is the whole point of blocking); and the admin's date-mode grid only queries date-specific blocks, so a recurring block that also covers the viewed date renders as an ordinary open, togglable slot with no indication that unblocking it wouldn't actually make it bookable.

\- \[x] Save confirmation messages: every admin mutation that previously gave no visible feedback (the form just re\\-rendered with the same-looking values, so it wasn't obvious a save had worked) now redirects back to itself with a query\\-param flag and shows a small green confirmation \\-\\- "Notes saved.", "Court activated."/"Court deactivated.", "Availability saved.", "Location added.", "Court added.", and a per\\-booking "Saved." for the admin's net\\-height/court\\-lines edit. Player and admin booking cancellation both now show "Booking cancelled." too, even though the status badge/disappearing row already made that fairly obvious. New shared `SuccessBanner` component (`src/components/SuccessBanner.tsx`) for the full\\-width ones; the per\\-court/per\\-booking ones (`notes\_saved`, `active\_changed`, `config\_saved` \\-\\- keyed by that row's id since a page can list several) are small inline text instead so it's clear which item was affected. Same pattern as the pre\\-existing `booked=1` confirmation on the court page \\-\\- a redirect\\-borne query param, not a JS toast \\-\\- so it stays consistent with the rest of the app and needed no new client components. `cancelBooking` gained a `redirect_to` field since it's called from two different pages that need to land back in different places.

\- \[x] Court details are now editable after creation \\-\\- an "Edit court" disclosure (native `<details>`, no JS) under each court in `/admin/locations/\[locationId]` opens a form for name, surface type, booking block size, and notes, all saved together by one new `updateCourt` action (`src/app/admin/actions.ts`), which replaces the earlier notes\\-only `updateCourtNotes`. Supersedes the "not editable after creation yet (not asked for)" note on the block\\-size entry above.

\- \[x] Location details (name, address, timezone) are also now editable after creation, same pattern as the court edit above \\-\\- an "Edit location" disclosure at the top of `/admin/locations/\[locationId]`, one new `updateLocation` action (`src/app/admin/actions.ts`). Timezone edits use `revalidatePath(\`/locations/${locationId}\`, "layout")` rather than listing every court subpage individually, since changing a location's timezone affects every court booking page under it.

\- \[ ] Dedicated booking confirmation page \\-\\- after `createBooking` succeeds, replace the current `?booked=1` banner on the court page with a real confirmation page (own route, e.g. `/bookings/\[bookingId]` or similar) showing the booking's date/time/court/requested config back to the player. Future, on that same page: "Add to calendar" across the popular options (Google Calendar, Apple Calendar, Outlook, and a downloadable `.ics` as the generic fallback) so a player can get the reservation onto their own calendar. Ties into the existing "Email confirmations for bookings and cancellations" backlog item above \\-\\- an emailed confirmation would want the same calendar\\-add links/attachment.

- [x] Superseded above: dedicated booking confirmation page shipped, at `/bookings/[bookingId]`. `createBooking` (`src/app/actions/bookings.ts`) now inserts with `.select("id").single()` and redirects to `/bookings/${id}?booked=1` instead of back to the court page; the court page's now-dead `booked` query param and banner were removed. The new page shows date/time, court/org name, requested net height/lines, a status badge, and a Cancel button reusing the existing `isCancellable`/`cancelBooking` (so gating matches `/bookings` exactly -- e.g. a booking that's already past shows no Cancel button even right after creation, same as it would from the list). RLS alone decides visibility (`.eq("id", bookingId)` returns nothing for a booking you can't see, which just 404s) -- no app-level ownership check needed, consistent with how the rest of the app defers to RLS. `/bookings` list rows now link to this page via "View details". "Add to calendar" links and email confirmations remain future work, unchanged from the note above.

\- \[ ] Weather widget on the court date view \\-\\- when a player is looking at a specific date's slots (`/locations/\[locationId]/courts/\[courtId]`), show a weather widget for that date. Needs a provider decision (e.g. Open\\-Meteo has no API key vs. OpenWeatherMap needs one) and a coordinates source \\-\\- `locations` currently only stores `address`/`timezone`, no lat/long, so this likely needs either a geocoding step on the address or new columns. Also worth deciding scope up front: relevant mainly for outdoor courts, and `surface_type` is free text today so it can't reliably tell indoor from outdoor.

- [x] Superseded above: weather widget shipped, on the player-facing court date view. Uses Open-Meteo (chosen since it needs no API key/signup, unlike OpenWeatherMap) via a new `src/lib/weather.ts` -- `fetchHourlyForecast` requests one calendar date's hourly temperature/weather-code/precipitation-probability for the location's already-stored `latitude`/`longitude` (from the earlier geocoding work), in the location's own timezone so returned hours need no conversion. Shows an hourly breakdown (not just a daily summary) as a horizontally-scrollable strip of cards -- emoji, temp, precip % -- matching the court's *actual open hours* for that date, not a fixed window. That required exposing the open/close-time resolution that was previously buried inside `computeOpenSlots` (override-closed / override-custom / weekly-rule fallback) as its own exported `resolveDayHours` in `src/lib/availability.ts`, which `computeOpenSlots` now calls internally too (behavior unchanged, now covered by `src/lib/availability.test.ts`, the first tests that module has ever had). The widget just doesn't render -- no error state, nothing player-visible -- whenever there's nothing to show it for: the location has no coordinates yet, the court's closed that day, or the date's outside Open-Meteo's ~16-day forecast range (any fetch failure or empty response is treated the same way, so a transient API hiccup fails silently rather than showing broken UI). Scoped to every court regardless of indoor/outdoor, per the user -- no new indoor/outdoor concept was added. On the admin side, `/admin/locations/[locationId]` now shows a visible yellow banner when the location has no coordinates ("players won't see weather forecasts") -- previously the only hint was a quiet line inside the collapsed "Edit location" disclosure, which this doesn't replace, just surfaces earlier. `filterHoursToWindow` (trims the API's 24-hour response to the open window) and `resolveDayHours` were both built test-first. Manually verified in the browser: real forecast data rendering for a verified location and matching its 14 open hours exactly, the widget disappearing when a location's coordinates were temporarily cleared (admin banner appearing at the same time), and disappearing again for a date over a month out while the booking slots themselves stayed unaffected.

\- \[x] Title case for page titles/headings \\-\\- all page `<h1>`/`<h2>`s and the sidebar nav labels ("Find a Court", "My Bookings", "Admin Dashboard", "Sign In", "Sign Up", "Confirm Booking", "Weekly Availability", "Upcoming Bookings", "Create an Account") switched from sentence\\-case to title case. Headings built from dynamic data (a location's or court's actual name) were left as\\-is \\-\\- title\\-casing user\\-entered names isn't the same problem.

\- \[x] Sidebar visual polish, partial \\-\\- `AppShell`'s sidebar and mobile header (`src/components/AppShell.tsx`) now use `dark:` variants (`bg-neutral-900`, matching borders/text/hover states) instead of a flat `bg-white` that clashed with the app's dark\\-mode `body` background. The fixed `w-64` width was left alone \\-\\- that's a layout change, not a color one, and wasn't asked for this pass.

\- \[ ] "My bookings" tabs \\-\\- split `/bookings` into "Upcoming bookings" and "Past bookings" tabs instead of one flat list sorted by `start_time` descending. Needs a definition of the upcoming/past boundary (`start_time` vs. now) and a tab UI \\-\\- either a small client component or two server\\-rendered sections toggled via a query param, consistent with how the rest of the app avoids client state where it can.

- [x] Superseded above: "My bookings" tabs shipped, plus a related fix the user asked for while defining the spec -- a booking that's *in progress* (started, not yet ended) is now its own time state, not lumped into "upcoming". New `src/lib/bookingStatus.ts` (`categorizeBookingTime`, `groupBookingsByTime`, `isCancellable`) is the first module in the project built test-first, per the new TDD convention above -- `src/lib/bookingStatus.test.ts` covers the boundary cases (exactly at start, exactly at end) before the implementation existed. `/bookings` now has Upcoming/Past tabs via `?tab=`, server-rendered query-param toggle (no client component, matching the original plan); the Upcoming tab shows in-progress bookings first (they sort earliest) followed by true upcoming ones, each still labeled "confirmed" but now also "In progress" when applicable. The Cancel button is gated on `isCancellable` (confirmed *and* upcoming) instead of just status -- a player could previously cancel an in-progress or past booking as long as it was still `confirmed`, since nothing auto-transitions status by time. The admin "Upcoming Bookings" list (`/admin/locations/[locationId]/courts/[courtId]`) already excluded in-progress/past bookings via its `gte("start_time", now)` query filter, so it was accidentally already safe -- left as-is, not switched to the new helper, since that would additionally start *showing* in-progress bookings there (arguably better, but a scope change nobody asked for).

\- \[x] Fixed a bug reported by the user: editing a location's or a court's details from `/admin/locations/\[locationId]` showed no confirmation the save went through. The `location\_saved`/`court\_saved` confirmation text from the "Save confirmation messages" entry above was rendering correctly all along \\-\\- it just lived inside the "Edit location"/"Edit court" `<details>` disclosures, which reset to their default closed state on the post\\-save redirect, hiding the message from view. Both disclosures now pass `open={...}` keyed off their own save flag so they stay open through the redirect that just saved them.

- [x] Location address validation/autofill and maps links -- admin location forms (`/admin`, `/admin/locations/[locationId]`) now use a new `AddressLookup` client component (`src/components/AddressLookup.tsx`) with a "Look up address" button that hits a new `/api/geocode` route (`src/app/api/geocode/route.ts`) proxying OpenStreetMap/Nominatim, chosen since it needs no API key or billing signup. Picking a result fills a simplified address plus `postal_code`, `latitude`, `longitude`, and the full `formatted_address` -- new nullable columns on `locations` (`supabase/migrations/0008_location_geocoding.sql`) -- which also unblocks the "needs... new columns" note on the Weather widget backlog item above. Player-facing pages (`/`, `/locations/[locationId]`, and the court booking page at `/locations/[locationId]/courts/[courtId]`, which previously showed no address at all) now link the address to Apple Maps on iOS or Google Maps elsewhere (`src/lib/maps.ts`), using the precise coordinates when available and falling back to a text query otherwise. Existing locations show "not yet verified" until an admin re-saves their address through the lookup -- same no-backfill pattern as `slot_size_minutes`.

- [x] `supabase/migrations/0008_location_geocoding.sql` applied to the live Supabase project; address lookup verified end-to-end for all three seeded locations (pick a result, save, confirm it persists and the maps link uses the saved coordinates). Also: direct Postgres access is now configured -- `DATABASE_URL` in `.env.local`, using Supabase's Session pooler connection string, since the direct `db.<project-ref>.supabase.co` host is IPv6-only and doesn't resolve from this environment -- with a new `npm run migrate -- <file>` script (`scripts/run-sql.mjs`, using the `pg` package) that applies a migration file directly. Future migrations no longer need the manual Supabase SQL-editor round-trip every prior migration required.

- [x] Searchable timezone picker, replacing the raw 400-entry `<select>` on the location admin forms -- new `TimezoneSelect` client component (`src/components/TimezoneSelect.tsx`) is a combobox with an always-visible search box, results formatted as "City, State, Country (GMT±H:MM)" (`src/lib/timezones.ts`, built on the `countries-and-timezones` package for country names and live `Intl` offset lookups so the GMT label is never stale), sorted alphabetically by city with the current selection pinned at the top. Search matches city/state/country/IANA id and a curated list of common aliases (e.g. "Pacific Time" finds `America/Los_Angeles`) so users aren't limited to searching by exact zone name. Fully custom-styled (including `dark:` variants) since a native `<select>`'s dropdown can't be restyled -- this is what was actually broken in the "not very readable in dark mode" bug report, not the closed-state control itself. Picking a geocoded address in `AddressLookup` now also auto-fills this picker via `tz-lookup` (computed server-side in `/api/geocode` so its data doesn't ship to the browser bundle), while staying manually overridable; a new `LocationFormFields` component (`src/components/LocationFormFields.tsx`) composes the two and holds the shared timezone state, replacing the separate `AddressLookup` + `<select>` blocks on both `/admin` and `/admin/locations/[locationId]`.

- [x] Fixed the same class of dark-mode bug reported separately: hovering a card on "Find a Court" (`/`), the admin locations list (`/admin`), a location's court list (`/locations/[locationId]`), and the hour-block buttons on the court booking page (`TimeBlockPicker.tsx`) all used a light-only `hover:bg-gray-50`/`hover:bg-gray-100` with no `dark:` variant -- in dark mode this painted a bright light background under text still styled for a dark background, making it briefly unreadable on hover. Added `dark:border-neutral-800 dark:hover:bg-neutral-800` (matching the convention `AppShell`'s sidebar already used) to all four.

- [x] Fixed a reported bug: a player extending their block selection on the court booking page (`TimeBlockPicker.tsx`) had no way to shrink it back down -- re-clicking either edge of an already-multi-block selection fell into the same "extend" branch as any other click, which recomputed an identical range and did nothing. Clicking the start or end edge of a multi-block selection now removes that one block instead (shrinking the range by one from that side); clicking an interior block (which can't be removed without breaking contiguity) resets the selection to just that block, matching the existing "clicking across a gap" convention. Deselecting a single remaining block is unchanged.

- [x] Test infrastructure added -- `vitest` + React Testing Library, jsdom environment (`vitest.config.mts`, `vitest.setup.ts`). `npm test` runs once, `npm run test:watch` stays open. First real test suite, `src/lib/maps.test.ts`, covers `buildMapsUrl`/`isApplePlatform`. Going forward the project follows TDD: a failing test gets written and shown before implementing a fix or a new function, see the "TDD workflow" convention above.

- [ ] Club admins, created in-app and distinguished from players -- today, being an org admin/manager is entirely manual/SQL (an `org_members` row inserted by hand); there's no UI for an existing owner/admin to grant someone else admin access to their club, and nothing in the app actually branches on `org_members.role` ('owner'/'admin'/'staff') or `users.role` ('player'/'org_admin') -- `/admin` access today just checks org membership at all, not a specific role (see "Role-based navigation sidebar" above). RLS already allows an org admin to insert new `org_members` rows for their own org (`org_members insert admin` in `0002_rls.sql`), so the missing piece is mostly UI: an "Invite/add admin" flow on `/admin` (add an existing user to the org by email, at a chosen role) plus deciding what, if anything, `role` should actually gate once it's settable (e.g. 'staff' managing the calendar but not billing/ownership transfers). Scoped to adding admins *within an org the requester already administers* -- distinct from the deferred `v2-org-creation-deferred` spec's "admin-assisted org creation with ownership transfer," which needs a platform-level admin concept this doesn't.

- [x] Superseded above: club admins shipped. An org owner/admin can now grant an existing player account admin access by email at `/admin/team` (linked from `/admin`, owner/admin only), choosing `admin` or `staff` -- `owner` assignment stays out of scope, deferred to the separate `v2-org-creation-deferred` spec. Backed by three new server actions (`addOrgMember`, `updateOrgMemberRole`, `removeOrgMember` in `src/app/admin/actions.ts`) and a narrow `security definer` Postgres function, `lookup_user_id_by_email` (`supabase/migrations/0010_club_admin_roles.sql`), since the `users` table's own RLS only allows selecting your own row. `role` now actually gates something for the first time in this app: RLS on `locations`/`courts` writes was tightened from any org member to owner/admin only (`supabase/migrations/0010_club_admin_roles.sql`), while `availability_rules`/`slot_overrides`/`bookings` stay open to `staff` -- so a staff member can manage weekly hours, date overrides, and bookings, but not create/edit courts or locations. The admin location page (`/admin/locations/[locationId]`) hides those staff-restricted forms/buttons entirely rather than letting RLS reject a submission. A `wouldRemoveLastOwner` guard (`src/lib/orgRoles.ts`, built test-first -- `src/lib/orgRoles.test.ts`) blocks removing or demoting an org's last owner, since RLS alone can't express that. The org-membership lookup that was previously duplicated three ways (root layout, admin layout, admin dashboard) is now a shared `getCurrentMembership` helper (`src/lib/orgMembership.ts`), plus a new `getRoleForOrg` for pages that need the role for a *specific* org rather than the user's first membership. Manually verified end-to-end: added a real second account as staff, confirmed the "no account found" and "already has access" errors, changed and reverted a role, removed access, confirmed the last-owner removal is blocked, and confirmed the staff account sees a cut-down `/admin/locations/[locationId]` (no edit/add-court/add-location) while hours/overrides/bookings on the court page are unaffected. `supabase/migrations/0011_org_member_emails.sql` was also applied, adding `list_org_member_emails` -- a second security-definer function, scoped to members of one org, that the `/admin/team` roster page uses to display member emails (same `users`-RLS gap as `lookup_user_id_by_email`, fixed the same way). `supabase/migrations/0012_restrict_email_lookup.sql` was applied on top, tightening `lookup_user_id_by_email` to require the caller be an org owner/admin, closing a gap found in final review where it was callable by any authenticated user (an account-existence oracle for any signed-in player). Correction to the verification note above: staff-role RLS enforcement was verified live via a real staff sign-in (a `courts` insert rejected with `42501`, a `locations` update affected zero rows, `availability_rules` stayed readable), but the staff-rendered UI itself (the "cut-down" admin location page) was verified by code review rather than live browser sign-in -- the controller's only browser session was the real owner account with no on-file password to recover it if lost, so it deliberately avoided signing out. Also left as-is, deliberately: any `admin` (not just the `owner`) can currently remove or demote an `owner` from `/admin/team`, since `wouldRemoveLastOwner` only protects the *last* owner, not owners specifically from non-owner admins -- a full fix needs RLS distinguishing "only an owner can act on an owner row," which belongs with the already-deferred `v2-org-creation-deferred` spec that owns ownership-transfer semantics, so a partial UI-only patch here would be misleading rather than actually correct.

- [ ] City-scoped home page with a default city set at signup -- the player-facing `/` currently lists every active-court location across every org with no geographic filtering. Wanted: at account creation, a player picks a "default city" from a constrained list (only cities/metro areas that currently have at least one club/location -- not free text), `/` then defaults to showing just that city's clubs, and a switcher lets them browse/book in a different city without changing their stored default (more like a session override than an account edit). Two real data-model gaps to resolve before building: (1) `locations` has no `city`/`metro_area` column to group or filter by -- `/api/geocode` (`src/app/api/geocode/route.ts`) already receives `city`/`town`/`village` from Nominatim per result but currently only folds it into the free-text `simpleAddress`, discarding it as a queryable field; (2) there's no app-level user profile row at all today -- `signUp` (`src/app/actions/auth.ts`) only creates a Supabase Auth user, nothing is ever written to the `users` table from the original data model spec, so "default city" needs a real place to live (either finally standing up `users`, or a lighter-weight `user_preferences`-style table). Worth deciding whether "city" should be its own column vs. derived by grouping locations' existing `latitude`/`longitude` into metro clusters -- the former is simpler and matches how the constrained picklist would be built (distinct cities already present in `locations`) but means every new location needs city correctly set, likely by trusting the geocode result rather than free text.

- [x] Superseded above (partially): City > Club > Location > Court drilldown shipped -- the player-facing home page (`/`) now shows a city list instead of a flat list of every location, drilling into `/cities/[city]` (that city's clubs) then `/clubs/[orgId]` (Task 7 -- new player-facing page, since none existed before; always shows *all* of a club's locations, not filtered to the city you arrived from, since one club can span several cities -- e.g. the seeded "Ace Volleyball Club" has locations in New York, Los Angeles, and City of Westminster) then the existing `/locations/[locationId]`. New nullable `locations.city` column (`supabase/migrations/0013_location_city.sql`, no backfill -- same pattern as the geocoding columns), populated through the existing address-lookup flow: Nominatim already computed a city value internally and discarded it (only folding it into the free-text `simpleAddress`); `extractCity` in `src/app/api/geocode/route.ts` pulls that into its own tested function and a new `GeocodeResult.city` field. Two new pure grouping functions, `groupLocationsByCity`/`clubsInCity` (`src/lib/cityGrouping.ts`, built test-first), back the city list and city-page club list. A location with no `city` yet (not re-verified through the lookup flow) doesn't disappear -- it shows under a new "Other locations" section on `/`. Only the *navigational hierarchy* half of the original backlog item shipped -- the personalization half (default city set at signup, a session-override switcher) is still deferred, unasked for in this pass. Blocker (1) noted on that still-open bullet above -- `locations` having no `city` column -- is now resolved by the `locations.city` column this entry just described.

- [x] UI consistency pass, part 1 of 2 -- reviewed the whole site for formatting/dropdown inconsistencies and fixed the two highest-priority findings (three others -- admin pages missing an `<h1>`, the login/signup heading not being responsive, and the Blocked Slots day-of-week picker's `border-black` being invisible in dark mode -- were left untouched, not requested). (1) Native `<select>` popups (role picker on `/admin/team`, net height/court lines on the booking confirm and admin court pages, court block-size selects on `/admin/locations/[locationId]`) always rendered their open dropdown in light-mode browser chrome regardless of the page's own theme, since nothing told the browser the page supports dark mode -- fixed with a single `color-scheme: dark;` added to the existing `@media (prefers-color-scheme: dark) { :root { ... } }` block in `src/app/globals.css`, confirmed via `getComputedStyle(document.documentElement).colorScheme` reading `"dark"` (the popup itself is OS-level chrome, invisible to a screenshot, but this is the standard mechanism browsers use to theme it). (2) Every light-only status/info banner (`bg-{red,green,yellow,blue}-50` + matching `-800` text, no `dark:` variant -- `SuccessBanner.tsx`, the login/signup error banners, the booking-confirm "sign in" notice, the admin team-page and court-page error banners, the location "not verified" banner, and the blocked-slots grid's red "blocked" button state) gained `dark:bg-*-950 dark:text-*-300` variants, matching the `dark:text-*-400`-style convention already used elsewhere (`AddressLookup.tsx`, `TimezoneSelect.tsx`). Verified live in the browser's dark-mode emulation (the login error banner, previously a stark light-red box, now renders as a dark, readable one) and confirmed light mode is pixel-identical to before. No new tests -- both fixes are CSS/className-only changes to existing pages, consistent with this codebase's convention of not unit-testing page components.

- [x] UI consistency pass, part 2 of 2 -- the three findings deferred from part 1 above, all now fixed. (1) Every admin page's top-level heading was a `<h2>` with no `<h1>` anywhere under `/admin`, while every player-facing page uses `<h1>` -- promoted the page-level heading (not the "Date Overrides"/"Blocked Slots"/"Upcoming Bookings" subsection headings, which stay `<h2>`) to `<h1>` on all 6 admin pages (`admin/page.tsx`, `admin/locations/[locationId]/page.tsx`, `admin/locations/[locationId]/hours/page.tsx`, `admin/locations/[locationId]/hours/confirm/page.tsx`, the "Weekly Availability" heading on the per-court page, `admin/team/page.tsx`) -- tag only, same `text-lg font-medium` styling as before, since admin's more compact look wasn't part of what was asked. (2) `login`/`signup` used a fixed `text-2xl font-semibold` instead of the `text-xl font-semibold sm:text-2xl` every other page's `<h1>` uses -- matched. (3) The Blocked Slots day-of-week picker's selected-day `border-black` (`admin/locations/[locationId]/courts/[courtId]/page.tsx`) was invisible against the dark background -- added `dark:border-white`, confirmed via computed style (`rgb(255, 255, 255)` in dark mode) and confirmed light mode unchanged. All CSS/tag-only changes, no new tests, verified live in the browser (dark and light).

- [x] Special Events, core (Plan 1 of 4) shipped -- locations can now host tournaments, leagues, open-play sessions, and clinics as a first-class `events`/`event_sessions` concept, browsable by players across the full City > Club > Location hierarchy. No registration, teams, or brackets yet -- see `docs/superpowers/specs/2026-08-30-special-events-design.md` for the full four-part design (this is item 1 of its "Future Decomposition" section) and `docs/superpowers/plans/2026-08-30-special-events-core.md` for the implementation plan. **Court-blocking, the architectural centerpiece:** rather than a parallel conflict-checking mechanism, each `event_sessions` row also creates a row in the existing `bookings` table (new `source` column, `'player' | 'event'`; new nullable `event_session_id` FK on delete cascade; `user_id` is now nullable, required only when `source = 'player'`) -- so an event's reserved court time is governed by the same GIST exclusion constraint that already makes double-booking impossible (`supabase/migrations/0015_events_core.sql`), and `computeOpenSlots`/the `booked_slots` view needed zero changes. **Admin:** a new "Events" section per location (`/admin/locations/[locationId]/events` list/create, `/admin/locations/[locationId]/events/[eventId]` manage) lets any org member (staff included) create an event, edit its details, and add/remove sessions (court + time, converted from the admin's wall-clock input via the location's own timezone). **Player:** a new "Events" nav item and `/events` page (City-grouped, soonest-first, reusing a new `groupEventsByCity`/`sortBySoonestSession` pure-logic module in `src/lib/eventGrouping.ts`, built test-first) plus new "Events in {city}"/"Upcoming Events" sections added to the existing city and location pages, all linking to a new `/events/[eventId]` detail page. Draft events (`status = 'draft'`) and cancelled events are excluded from every player-facing list query -- only a direct link still shows a cancelled event, with a notice. Built via subagent-driven-development, 7 tasks + a fix round from Task 1's own review (a missing RLS insert policy for `source = 'event'` bookings, `supabase/migrations/0016_events_booking_insert_policy.sql`) + one comprehensive fix round from the final whole-branch review, which caught what no single task-scoped review could see: the new event-sourced `bookings` rows were rendering on the pre-existing admin court page as ordinary, cancellable player bookings -- cancelling one would have silently freed a live event's court time for player double-booking. Fixed by rendering `source = 'event'` rows read-only ("Reserved by event", no Cancel/edit controls) plus a defense-in-depth guard directly in the shared `cancelBooking` action refusing to touch a `source = 'event'` row regardless of which page reaches it. The same final-review pass also fixed: missing `revalidatePath` calls after adding/removing a session (court pages and player events routes weren't being told to refresh); the admin event-detail page not being scoped to its location, which let `addEventSession` derive its timezone conversion from the wrong location's URL param instead of the event's actual one; a dead "event created" confirmation banner (redirected to the detail page, but only the list page knew how to render it); and cancelled events rendering as ordinary upcoming events on every player-facing list instead of being excluded. `fee_cents`/payment fields, team registration, and brackets are deliberately absent -- those are Plans 2-4, spec'd but not scheduled; the roadmap in this file's "Build order" section above was updated to slot Special Events in ahead of Payments as the new current phase.

- [x] Expanded seed data for exercising the Special Events feature and multi-court locations -- run directly against Supabase with the service-role key, not committed (same pattern as the earlier "9am-11pm every day" court-hours seeding). Every location now has an active court count of 3-8, each with full weekly availability (9am-11pm daily): Chewsday Innit 5 courts, Loco Coco Ball Slammers 3 courts, Main Facility 6 active courts (plus its pre-existing inactive test court). Three more tournaments were added alongside the original Fall Open Tournament, spanning varied statuses and registration modes -- Winter Classic (Chewsday Innit, published, team/self-formed, 2 sessions), Beach Bash Open (Loco Coco, registration_open, individual), and Spring Draft Tournament (Main Facility, deliberately left in `draft` status to keep verifying draft-filtering with more data present). Two test accounts were also created via the Supabase Admin API (`email_confirm: true`, no confirmation-email step needed) -- **`test.player@courtscheduler.dev`** (plain player, no org membership) and **`test.owner@courtscheduler.dev`** (owner of Ace Volleyball Club, alongside the real account), both password **`TestPass123!`**. Sign in at `/login` same as any account.

- [x] Special Events, registration (Plan 2 of 4) shipped -- players can now actually register for the events browsable since Plan 1: individual sign-up, self-formed team registration (captain + name-only roster -- the approved data model has no email column, so the earlier spec's "name/email" prose was superseded by its own table), admin-assembled team registration (individual sign-up now, an org groups registrants into teams later), capacity with automatic waitlisting/promotion, and a new "My Events" page for players to see and cancel their own registrations. See `docs/superpowers/plans/2026-08-31-special-events-registration.md`. Three new tables (`event_teams`, `event_team_members`, `event_registrations` -- the capacity-consuming unit, one row per team *or* per individual) plus two narrow `security definer` RPCs: `promote_next_waitlisted` (FIFO-promotes the oldest waitlisted registration when a spot frees, needed because a player cancelling their own registration must update a *different* player's row) and `list_event_registrant_emails` (lets an org member see individual registrants' emails for team assembly, the same `users`-RLS-bypass pattern as `list_org_member_emails`). A new `event_registration_counts` view (`event_id, status, count`, no identity) mirrors `booked_slots`'s privacy-preserving shape, since `event_registrations` is deliberately *not* public-select but any visitor still needs to know whether an event is full. Capacity checking is a deliberate app-level recount-then-insert, not a DB exclusion constraint -- registration capacity is a soft business limit, unlike the court-booking double-booking guarantee's physical-impossibility contract. Built via subagent-driven-development, 6 tasks, 5 of which needed one fix round each (a per-task reviewer independently re-verified every fix via live RLS role-impersonation rather than trusting a superuser connection, learning directly from a gap that slipped through the *previous* plan's Task 1). Notably: `event_registrations.registered_at` is now forced server-side via a `before insert` trigger (`supabase/migrations/0018`), since a `default now()` only applies when a column is *omitted*, not when a client explicitly supplies a value -- without the trigger, a player could fabricate an early timestamp to jump the waitlist queue.

  The final whole-branch review found what no per-task review could: two Critical bugs from pieces that individually worked but didn't compose correctly. (1) `registerForEvent` computed capacity/waitlist status by counting `event_registrations` under the *caller's own* RLS visibility (a plain player sees zero rows there, since that table isn't public-select) instead of the `event_registration_counts` view built for exactly this reason -- Task 4's player-facing page correctly used the view, Task 3's action did not, so capacity was never enforced and the waitlist half of the plan didn't function. (2) the event detail page derived "am I registered" from `event_teams.captain_user_id` instead of the actual `event_registrations` row, which broke three ways: a permanent, in-app-unrecoverable lockout after cancelling a self-formed team registration (the team row survives cancellation forever); a waitlisted team shown as "registered"; and a duplicate registration possible after admin team assembly. Fixed by making `event_registrations` the sole source of truth everywhere, found either directly (individual) or via `event_team_members` team membership (which correctly covers self-formed captains, self-formed teammates, and admin-assembled members alike). Five further Important fixes landed in the same pass: `event_teams`/`event_team_members` had no DELETE policy at all, so a roster-creation-failure rollback silently no-op'd under RLS (directly causing half of bug 2); `event_registrations`' update policy had a `using` clause but no `with check`, letting a registrant self-PATCH `waitlisted` → `registered` -- the same queue-jumping class of bug the `registered_at` trigger closed on the insert path, reached here via update instead, fixed with `with check (is_org_member(...) or status = 'cancelled')`; `assembleEventTeam` never called `promote_next_waitlisted` after consolidation (which can net-free capacity) and hardcoded the new team's status to `'registered'` regardless of actual fullness; `registerForEvent` had no server-side event-status gate, so a player could register for a draft/cancelled/completed event by direct POST (fixed with a minimum-viable `status in ('published', 'registration_open')` check -- `registration_opens_at`/`registration_closes_at` timing windows remain unvalidated, a known, deliberately deferred gap, not silently half-implemented); and admin-assembled team registrations (which have no captain at all) were uncancellable by anyone in the app, since the Cancel gate required a captain -- fixed by broadening both the RLS policy and the "My Events" UI gate from "captain only" to "any team member" (self-formed teams already always include the captain as a team-member row, so this is a strict superset for that case).

  Two smaller lessons from this fix round worth carrying forward: first, the fix for the `assembleEventTeam` status calculation initially shipped with its own bug -- it read `event_registration_counts` *after* deleting the original individual registrations (so the count already excluded them) and then subtracted their count *again*, undercounting and wrongly marking a newly-assembled team `'registered'` when it should have been `'waitlisted'`; the implementer who wrote the fix caught this themselves via live reproduction before it was signed off, and it was corrected in the same pass. Second, the whole-branch re-review of the fix round found that the Important-5 fix (uncancellable admin-assembled registrations) was only half-landed -- the RLS policy was correctly broadened, but the UI gate on `/events/registrations` was never updated to match, so the finding's actual symptom persisted; this last piece was applied directly and re-verified live (a real admin-assembled team member, previously unable to see Cancel at all, now can) after a session interruption meant the originally-dispatched fix agent didn't get to it. `fee_cents`/payment processing and brackets remain deliberately absent -- Plans 3-4, spec'd but not scheduled.

- [x] Special Events, brackets (Plan 3 of 4) shipped -- events can now generate real brackets from their registered teams/individuals (single-elimination, double-elimination, round robin, pool play), record per-set results, auto-advance winners/losers, compute standings, and show both to players. See `docs/superpowers/specs/2026-08-31-special-events-brackets-design.md` and `docs/superpowers/plans/2026-08-31-special-events-brackets.md`. One new table, `event_matches` (generic `bracket`/`round_number`/`slot_in_round` shape with self-referencing `*_advances_from_match_id` links, covering every format uniformly), plus `event_match_sets` for per-set scores and a nullable `display_name` on `event_registrations` for individual (non-team) participants (`supabase/migrations/0020_event_brackets.sql`). Four pure generation functions (`src/lib/bracketGeneration.ts`) build a match graph in memory with client-generated UUIDs before a single insert; a pure `propagateAdvancement` (`src/lib/matchAdvancement.ts`) fills a completed match's winner/loser into whatever references it, flagging rather than silently overwriting an already-completed downstream match; a pure `computeStandings` (`src/lib/standings.ts`) ranks by win % then point differential then two-way head-to-head. **The league-shape fix mid-design:** the original scope had matches carrying no time information at all (fine for a same-day tournament, useless for a league's weekly season) -- caught before implementation and fixed by adding an optional `event_matches.session_id` linking a match to one of the event's existing `event_sessions`, settable manually via Edit Match or in bulk via a new "Auto-assign to sessions" action (`pairMatchesToSessions` in `src/lib/matchScheduling.ts`, a simple ordered zip -- round order to session start-time order, leftover matches/sessions handled gracefully, no capacity-aware scheduling). Admin also gets manual overrides for real-world chaos: editing any match regardless of status (team, sets, winner, session, an `admin_note` shown to players), and withdrawing a registration either forfeits their pending match to the opponent or substitutes a different registration into the slot.

  Manual browser verification (not just the unit suite) found four real bugs the tests missed, all fixed in the same pass: (1) **Critical** -- the double-elimination generator's losers-bracket round 1 was wired to advance the *winner*, not the *loser*, of each winners-round-1 match, completely inverting double-elimination semantics at its first step; no existing test checked LR1's `advancement_type`, only match counts and the grand final's links, so a new regression test now completes a real match and asserts the loser (not the winner) fills the losers-bracket slot. (2) The admin "Edit Match" form's `<select>` elements used uncontrolled `defaultValue`, which React only applies on first mount -- since Next.js Server Action redirects are client-side transitions rather than full page reloads, the Winner select especially went stale after a result was recorded or advancement filled a slot, meaning saving any other field on an already-decided match would silently blank the winner and revert its status; fixed by keying the form on the match's mutable fields so it remounts on change. (3) A bye auto-completes itself at generation time, which isn't an admin-entered result, but both the Regenerate button's visibility and the `regenerateBracket` action's guard checked for *any* completed match -- making regeneration permanently unavailable for any bracket with a bye, even before a single real match had been played; both now exclude `is_bye` matches. (4) The player-facing round robin/pool play view only rendered a standings table, not the flat match list with session date/court info the spec called for -- the whole point for a league's weekly matches -- added to match what the elimination-bracket view already did. A fifth, minor cosmetic fix: the admin page's registrant name lookup excluded cancelled (withdrawn) registrations, so a withdrawn player's historical bye/match showed "TBD" instead of their name; split into a separate unfiltered query, matching what the player page already did correctly. Verified live end-to-end: a 6-player single-elim bracket with auto byes, a normal result, a forfeit, the manual-override cascade-warning banner (editing a completed match that already fed a completed downstream match correctly left that downstream match untouched and named it in a review banner), and a withdrawal exercising both the forfeit and substitute paths; a corrected double-elim bracket played through its first round with the loser now landing in the losers bracket; a 4-team round robin with weekly sessions and "Auto-assign to sessions" correctly scheduling matches in chronological order and leaving the rest for manual assignment; the mobile-viewport horizontally-scrolling bracket tree reaching every round via touch/scroll. Pool play specifically (shares `generateRoundRobinMatches` under the hood, called once per pool) and a full double-elimination playthrough to the grand final were not live-verified beyond the unit suite, given the format's already-thorough test coverage -- a reasonable stopping point, not a silent gap. Follow-up backlog, not part of this plan: capacity-aware auto-scheduling (if the simple ordered-pairing ever proves insufficient for multi-court weeks) and user profiles (name, gender, level of play) as their own cross-cutting feature. Payment integration (Plan 4 of 4) remains the only piece left before the original v3 Special Events phase is complete.

- [x] Team roster visibility & membership integrity shipped -- any player can now see a self-formed team's full roster, and every new roster spot resolves to a real account: immediately if the teammate already has one, or via a pending invite claimed at their first sign-in if not. See `docs/superpowers/specs/2026-09-01-team-roster-visibility-design.md` and `docs/superpowers/plans/2026-09-01-team-roster-visibility.md`. One new nullable `invited_email` column on `event_team_members` (unique while pending, app-wide, so the sign-in-time claim lookup is unambiguous) plus two narrow `security definer` RPCs (`supabase/migrations/0021_team_roster_invites.sql`): `find_registered_user_by_email` (exact-match only, callable by any authenticated player, not just org members -- returns an opaque `user_id` or nothing, never a list, so it's not a new enumeration surface) and `claim_pending_team_invites` (takes no parameters, reads the caller's own id/email from `auth.uid()`/`auth.users` only, so a roster spot can only ever be linked to the account that actually owns that inbox). `registerForEvent`'s self-formed team path now requires a name *and* email per teammate slot (partial pairs rejected with a friendly per-slot error) and looks each email up before inserting -- a match links `user_id` immediately, no match creates a pending spot with `invited_email` set. **A design correction found while writing the plan, before any code was touched:** the spec originally called for claiming pending invites in `signUp`, but `supabase.auth.signUp()` doesn't establish an authenticated session in this app (email confirmation is required before login works), so a `security definer` RPC relying on `auth.uid()` would have had no caller to authenticate at that point -- moved to `signIn` instead, the first point the account is genuinely authenticated as that email; the spec was corrected in place before the plan was written against it. `invited_email` is deliberately never selected or rendered by any player-facing query (including the new "Rosters" section) -- only the two RPCs and the existing org-side admin-assembly flow read it -- so a pending spot shows only a plain "(pending)" label, never the email itself. This also meant fixing a pre-existing leak in the same code path: the captain's own roster row previously defaulted to their raw email as its `display_name`; now requires a typed display name like everyone else. Verified live end-to-end (no worktree this time, working directly on `main` per the user's choice): a teammate whose email matched an existing account linked immediately; one whose email didn't got a "(pending)" spot; inviting that same pending email to a second team produced the friendly "already has a pending invite elsewhere" collision error with a clean rollback (confirmed no orphaned `event_teams` row); a name-without-email slot was rejected before any database write; and, most importantly, signing in as a brand-new account created with the pending email's exact address auto-linked the spot and cleared its "(pending)" label -- which also, as a bonus confirmation, made the app correctly recognize that account as already registered for the event via the newly-set `user_id`, showing the pending mechanism is fully integrated with existing registration-status logic, not just a database-level curiosity. A pre-existing team's old free-text-only roster (no `user_id`, no `invited_email`, predating this migration) rendered without erroring, showing as "(pending)" per the accepted, documented imprecision for historical data (there's no email to distinguish a true pending invite from an old free-text name without ever reading `invited_email`, which the player-facing page must never do). No backfill, matching this project's established convention. Self-removal for a newly-linked (non-captain) teammate and a real player-name search (`users` still has no name field -- a separate, already-deferred "user profiles" backlog item) remain out of scope, unaddressed by design.

