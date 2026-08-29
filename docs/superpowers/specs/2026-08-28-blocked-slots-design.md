# Per-Slot Availability Blocking — Design Spec

Status: approved for implementation
Date: 2026-08-28

## Goal

Today `availability_rules` (weekly recurring hours) and `slot_overrides`
(one-off date exceptions) can only express a single open/close window per
day — the whole window is uniformly bookable. An admin who wants to block
just part of a day (e.g. "closed for maintenance every Monday noon–1pm," or
"blocked 2–3pm this Saturday for a private event") has no way to do that
without closing the entire day.

This adds per-slot blocking on top of both existing mechanisms — one
recurring (by day-of-week) and one one-off (by specific date) — sharing a
single new table and a single admin UI section, rather than building two
separate features.

## Non-goals

- **Blocking does not touch existing bookings.** It only affects future
  availability computation, exactly like `slot_overrides.is_closed`
  already works today — no retroactive cancellation, no conflict warning
  if an admin blocks a slot that already has a confirmed booking.
- **The grid doesn't show live booking state.** Just Open/Blocked, derived
  from `blocked_slots` alone. A future pass could overlay booked slots too;
  not asked for here.
- **No change to `computeOpenSlots`'s public booking behavior** beyond the
  new exclusion — duration/step semantics, override resolution, and the
  booked-range exclusion are all unchanged.

## Data model

New migration: `supabase/migrations/0014_blocked_slots.sql`

```sql
-- Per-slot blocking, layered on top of availability_rules (recurring) and
-- slot_overrides (whole-day/custom-hours one-offs). A row with day_of_week
-- set blocks that slot every week on that day; a row with date set blocks
-- it for just that one date -- exactly one of the two is ever set. Block
-- granularity always matches the court's own slot_size_minutes (same value
-- computeOpenSlots already uses for durationMinutes/stepMinutes), so a
-- blocked start_time lines up exactly with a real candidate booking start
-- -- no overlap math needed, just exact-time-of-day matching.
create table blocked_slots (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id) on delete cascade,
  day_of_week smallint check (day_of_week between 0 and 6),
  date date,
  start_time time not null,
  check ((day_of_week is not null) <> (date is not null))
);

create unique index blocked_slots_recurring_unique
  on blocked_slots (court_id, day_of_week, start_time)
  where day_of_week is not null;

create unique index blocked_slots_date_unique
  on blocked_slots (court_id, date, start_time)
  where date is not null;

create index blocked_slots_court_idx on blocked_slots (court_id);

alter table blocked_slots enable row level security;

-- Public select from the start (`using (true)`), not authenticated-only --
-- learning from the earlier gap where availability_rules/slot_overrides
-- were initially authenticated-only and had to be fixed in
-- 0003_public_read.sql once it broke anonymous browsing of the court page.
-- Write access matches slot_overrides: any org member (including staff),
-- not owner/admin-only -- this is a "timing" action per the club-admins
-- capability split.
create policy "blocked_slots select all" on blocked_slots
  for select using (true);
create policy "blocked_slots write member" on blocked_slots
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "blocked_slots delete member" on blocked_slots
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));
```

No `update` policy — toggling a slot is insert-a-row-or-delete-a-row (a
presence/absence fact), never an in-place field change.

**Known accepted edge case:** if a court's `slot_size_minutes` changes after
some blocks were created at the old granularity, stale blocks that no
longer align with a real candidate start simply stop matching (silently
inert, not cleaned up). Consistent with how this app already treats a
`slot_size_minutes` change as not retroactively touching existing bookings
either — not a new problem this feature introduces.

## Pure logic

**`src/lib/availability.ts`** — new exported function, built test-first:

```ts
// Candidate start times ("HH:MM:SS") within [openTime, closeTime) at the
// given step, matching exactly how computeOpenSlots's own instant-based
// loop steps -- used both internally there and by the admin grid builder.
export function generateSlotStarts(
  openTime: string,
  closeTime: string,
  stepMinutes: number
): string[];
```

`computeOpenSlots` gains a new `blockedSlots?: BlockedSlot[]` param:

```ts
export interface BlockedSlot {
  day_of_week: number | null;
  date: string | null; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS"
}
```

Inside the loop, alongside the existing instant-based `start`/`end`
computation, track the parallel wall-clock time-of-day for that same
iteration (via `generateSlotStarts(hours.openTime, hours.closeTime,
stepMinutes)`, indexed by the same loop counter as the instant loop, since
both start from the same `openTime`/`openInstant` and advance by the same
`stepMinutes`/`stepMs`). A slot is excluded if its wall-clock start matches
any `blockedSlots` entry whose `day_of_week` equals that calendar date's
day of week (`dayOfWeekFor(date)`) or whose `date` equals the `date`
argument itself, in addition to the existing booked-range exclusion.

Built test-first (`src/lib/availability.test.ts`, extending the existing
file): `generateSlotStarts` edge cases (exact division, remainder,
zero-length window), plus new `computeOpenSlots` cases — a recurring block
excludes the matching weekday's slot but not other weekdays; a date-specific
block excludes only that exact date; blocking combines correctly with an
existing booked range and with a `slot_overrides` custom-hours window.

**`src/lib/blockedSlots.ts`** (new file, admin-grid-focused, built
test-first) — separate from `availability.ts` since this is admin-UI
concern, not player-facing slot computation, even though it imports
`generateSlotStarts` from there:

```ts
export interface SlotBlockState {
  startTime: string; // "HH:MM:SS"
  blocked: boolean;
}

export function buildSlotGrid(
  openTime: string,
  closeTime: string,
  stepMinutes: number,
  blockedStartTimes: string[] // "HH:MM:SS" values already blocked
): SlotBlockState[];
```

## Admin UI

New "Blocked Slots" section on the existing per-court admin page
(`src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx`),
positioned between the existing "Date Overrides" and "Upcoming Bookings"
sections (both restrict-availability concerns belong together).

**Mode + day/date picker**, query-param driven (`?block_mode=recurring&
block_day=1` or `?block_mode=date&block_date=2026-09-01`) — no client
component, matching this app's established "avoid client state, use query
params" convention (e.g. `/bookings?tab=`, the court page's own `?date=`).
Two links switch mode; recurring mode shows 7 day-of-week links (Sun–Sat);
date mode shows a plain `<input type="date">` + a GET-submit button.
Default (no params): recurring mode, today's day-of-week in the location's
timezone.

**Resolving the window to show:**
- Recurring mode: look up the weekly rule for that `day_of_week` directly
  (no override resolution — a recurring block applies to the general
  pattern, independent of any specific date's one-off override). No rule
  for that day → "This day is closed in the weekly schedule," no grid.
- Date mode: `resolveDayHours(date, rules, overrides)` — the same
  override-aware resolution already used by the booking page and the
  weather widget, so a one-off closed/custom-hours override is respected
  automatically. Closed → "This date is closed," no grid.

**The grid:** `buildSlotGrid(...)` renders one small form per slot — a
button labeled with the time, styled differently when blocked (e.g. a red
background) vs. open. Clicking submits to a new `toggleBlockedSlot` action
(`src/app/admin/actions.ts`) with the court id, mode, day-of-week-or-date,
start time, and current blocked state; the action inserts a row (blocking)
or deletes the matching row (unblocking, matching on the appropriate
unique index), then redirects back to the same `?block_mode=...` view.

## Testing plan

- `generateSlotStarts` and the new `computeOpenSlots` blocking cases —
  test-first, extending `src/lib/availability.test.ts`.
- `buildSlotGrid` — test-first, `src/lib/blockedSlots.test.ts`.
- No new tests for the admin page/action themselves (server components and
  actions aren't unit-tested elsewhere in this codebase either) — verified
  manually in the browser.

## Manual verification plan

- Apply and verify the migration (table + both partial unique indexes).
- Recurring mode: block a slot on a given weekday, confirm the player
  booking page for a date on that weekday no longer offers it, confirm a
  date on a *different* weekday is unaffected.
- Date mode: block a slot for one specific date, confirm the player booking
  page for that exact date no longer offers it, confirm the same time slot
  on any other date is unaffected.
- Unblock both, confirm the slots return.
- Confirm a slot with an existing confirmed booking can still be blocked
  without touching the booking (no cancellation, no error).
- Confirm the day-closed / date-closed no-grid messages render correctly
  for a day with no weekly rule and a date closed via `slot_overrides`.
- Confirm a staff-role account (not owner/admin) can use this section —
  matches the club-admins capability split (staff manages timing).
