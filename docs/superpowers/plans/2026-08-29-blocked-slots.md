# Blocked Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin block specific slots within a day's hours — recurring by day-of-week, or one-off by date — instead of only being able to set/close a whole day.

**Architecture:** A single new `blocked_slots` table (day-of-week XOR date, per court, per start time) backs both modes. `computeOpenSlots` gains a `blockedSlots` param it excludes candidates against. A shared pure `generateSlotStarts` helper produces the same candidate-start list used both inside `computeOpenSlots` and by a new admin grid-builder (`buildSlotGrid`). One new "Blocked Slots" section on the existing per-court admin page lets an admin toggle slots via small per-cell forms; the player-facing court page passes the relevant blocks into `computeOpenSlots`.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (Postgres + RLS), Vitest for pure-logic tests.

**Spec:** [docs/superpowers/specs/2026-08-28-blocked-slots-design.md](../specs/2026-08-28-blocked-slots-design.md)

## Global Constraints

- Block granularity always equals the court's own `slot_size_minutes` — never a hardcoded 30 minutes.
- Blocking never touches existing bookings — it only affects future `computeOpenSlots` output, exactly like `slot_overrides.is_closed` already works.
- `blocked_slots` is public-select (`using (true)`) from the start, not authenticated-only — learned from the earlier gap where `availability_rules`/`slot_overrides` had to be fixed after the fact.
- Write access (insert/delete) matches `slot_overrides`: any org member, including `staff` — not owner/admin-only.
- Every task ends with a commit.

---

### Task 1: Migration — `blocked_slots` table

**Files:**
- Create: `supabase/migrations/0014_blocked_slots.sql`

**Interfaces:**
- Consumes: `public.is_org_member`, `public.org_id_for_court` (already exist, `0002_rls.sql`).
- Produces: table `blocked_slots(id, court_id, day_of_week, date, start_time)` with two partial unique indexes — Tasks 5, 6, 7 read/write it by these exact column names.

- [ ] **Step 1: Write the migration file**

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

-- Public select from the start -- learned from the earlier gap where
-- availability_rules/slot_overrides were initially authenticated-only and
-- broke anonymous browsing of the court page until 0003_public_read.sql
-- fixed it. Write access matches slot_overrides: any org member (including
-- staff), not owner/admin-only -- this is a "timing" action per the
-- club-admins capability split.
create policy "blocked_slots select all" on blocked_slots
  for select using (true);
create policy "blocked_slots write member" on blocked_slots
  for insert with check (public.is_org_member(public.org_id_for_court(court_id)));
create policy "blocked_slots delete member" on blocked_slots
  for delete using (public.is_org_member(public.org_id_for_court(court_id)));
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0014_blocked_slots.sql`
Expected: `Applied supabase/migrations/0014_blocked_slots.sql`

- [ ] **Step 3: Verify the table, indexes, and policies**

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const indexes = await client.query(\"select indexname from pg_indexes where tablename = 'blocked_slots' order by indexname\");
  console.log('indexes:', indexes.rows);
  const policies = await client.query(\"select policyname, cmd from pg_policies where tablename = 'blocked_slots' order by policyname\");
  console.log('policies:', policies.rows);
  await client.end();
});
"
```

Expected: `indexes` includes `blocked_slots_court_idx`, `blocked_slots_date_unique`, `blocked_slots_pkey`, `blocked_slots_recurring_unique` (4 rows). `policies` includes `blocked_slots delete member` (DELETE), `blocked_slots select all` (SELECT), `blocked_slots write member` (INSERT) (3 rows).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_blocked_slots.sql
git commit -m "Add blocked_slots table for per-slot availability blocking"
```

---

### Task 2: `generateSlotStarts` pure function + export `dayOfWeekFor`, built test-first

**Files:**
- Modify: `src/lib/availability.ts`
- Modify: `src/lib/availability.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function generateSlotStarts(openTime: string, closeTime: string, stepMinutes: number): string[]` — Tasks 3 and 4 use it. `dayOfWeekFor` (already existed, private) becomes exported — Tasks 3 and 7 import it.

This task also introduces two small **private** (unexported) helpers, `parseTimeToMinutes`/`formatMinutesAsTime`, that Task 3 reuses directly (same file) — do not export them, they're internal to this module.

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to the end of `src/lib/availability.test.ts` (do not touch the existing `resolveDayHours` block above it):

```ts
describe("generateSlotStarts", () => {
  it("generates evenly-divided slots across the window", () => {
    expect(generateSlotStarts("09:00:00", "11:00:00", 60)).toEqual(["09:00:00", "10:00:00"]);
  });

  it("stops before a slot would run past the close time", () => {
    expect(generateSlotStarts("09:00:00", "10:30:00", 60)).toEqual(["09:00:00"]);
  });

  it("handles a step that leaves a remainder at the end of the window", () => {
    expect(generateSlotStarts("09:00:00", "10:15:00", 30)).toEqual(["09:00:00", "09:30:00"]);
  });

  it("returns an empty array when the window is shorter than one step", () => {
    expect(generateSlotStarts("09:00:00", "09:20:00", 30)).toEqual([]);
  });

  it("returns an empty array when open equals close", () => {
    expect(generateSlotStarts("09:00:00", "09:00:00", 30)).toEqual([]);
  });

  it("accepts HH:MM inputs without seconds", () => {
    expect(generateSlotStarts("09:00", "10:00", 30)).toEqual(["09:00:00", "09:30:00"]);
  });
});
```

Also update the import line at the top of the file from:

```ts
import { resolveDayHours, type AvailabilityRule, type SlotOverride } from "@/lib/availability";
```

to:

```ts
import {
  resolveDayHours,
  generateSlotStarts,
  type AvailabilityRule,
  type SlotOverride,
} from "@/lib/availability";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- availability`
Expected: FAIL — `generateSlotStarts is not a function` (or an import-resolution error), while the existing `resolveDayHours` tests still pass.

- [ ] **Step 3: Write the implementation**

In `src/lib/availability.ts`, add these near the top, after the existing `dayOfWeekFor` function, and change `dayOfWeekFor`'s own declaration to be exported:

Replace:

```ts
function dayOfWeekFor(date: string): number {
  // Noon UTC avoids any date-boundary ambiguity; the calendar date itself
  // (not an instant) is what determines day-of-week, independent of timezone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
```

with:

```ts
export function dayOfWeekFor(date: string): number {
  // Noon UTC avoids any date-boundary ambiguity; the calendar date itself
  // (not an instant) is what determines day-of-week, independent of timezone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutesAsTime(totalMinutes: number): string {
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

// Candidate start times ("HH:MM:SS") within [openTime, closeTime) at the
// given step -- used both by computeOpenSlots below and by the admin
// blocked-slots grid builder (src/lib/blockedSlots.ts).
export function generateSlotStarts(
  openTime: string,
  closeTime: string,
  stepMinutes: number
): string[] {
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);
  const starts: string[] = [];
  for (let m = openMin; m + stepMinutes <= closeMin; m += stepMinutes) {
    starts.push(formatMinutesAsTime(m));
  }
  return starts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- availability`
Expected: PASS, 11 tests (5 existing `resolveDayHours` + 6 new `generateSlotStarts`).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (55 total: 49 baseline + 6 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "Add generateSlotStarts, export dayOfWeekFor"
```

---

### Task 3: `computeOpenSlots` blocking integration, built test-first

**Files:**
- Modify: `src/lib/availability.ts`
- Modify: `src/lib/availability.test.ts`

**Interfaces:**
- Consumes: `generateSlotStarts`, `dayOfWeekFor`, `parseTimeToMinutes`/`formatMinutesAsTime` (private, same file) from Task 2.
- Produces: `export interface BlockedSlot { day_of_week: number | null; date: string | null; start_time: string }`; `computeOpenSlots` gains an optional `blockedSlots?: BlockedSlot[]` param (default `[]`, fully backward compatible). Tasks 6 and 7 import `BlockedSlot` and pass `blockedSlots` to `computeOpenSlots`.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `src/lib/availability.test.ts`:

```ts
describe("computeOpenSlots blocking", () => {
  const rules: AvailabilityRule[] = [
    { day_of_week: 1, open_time: "09:00:00", close_time: "11:00:00" }, // Monday
    { day_of_week: 2, open_time: "09:00:00", close_time: "11:00:00" }, // Tuesday
  ];

  it("excludes a slot blocked recurringly on that day of week", () => {
    // 2026-08-31 is a Monday
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual(["2026-08-31T09:00:00.000Z"]);
  });

  it("does not exclude the same time on a different day of week", () => {
    // 2026-09-01 is a Tuesday
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-09-01",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T10:00:00.000Z",
    ]);
  });

  it("excludes a slot blocked for one specific date only", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: null, date: "2026-08-31", start_time: "09:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual(["2026-08-31T10:00:00.000Z"]);
  });

  it("does not exclude the same time on a different date", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: null, date: "2026-08-31", start_time: "09:00:00" }];
    // 2026-09-07 is also a Monday, but a different specific date
    const slots = computeOpenSlots({
      date: "2026-09-07",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-07T10:00:00.000Z",
    ]);
  });

  it("combines correctly with an existing booked range", () => {
    const blockedSlots: BlockedSlot[] = [{ day_of_week: 1, date: null, start_time: "10:00:00" }];
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [{ start_time: "2026-08-31T09:00:00.000Z", end_time: "2026-08-31T10:00:00.000Z" }],
      blockedSlots,
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots).toEqual([]);
  });

  it("defaults to no blocking when blockedSlots is omitted", () => {
    const slots = computeOpenSlots({
      date: "2026-08-31",
      timezone: "UTC",
      rules,
      overrides: [],
      bookedRanges: [],
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-08-31T09:00:00.000Z",
      "2026-08-31T10:00:00.000Z",
    ]);
  });
});
```

Update the test file's import line again, from the Task 2 version, to also bring in `computeOpenSlots` and `BlockedSlot` (both already existed/were added by earlier tasks, just not imported into this test file yet):

```ts
import {
  resolveDayHours,
  generateSlotStarts,
  computeOpenSlots,
  type AvailabilityRule,
  type SlotOverride,
  type BlockedSlot,
} from "@/lib/availability";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- availability`
Expected: FAIL — `BlockedSlot` type doesn't exist yet / `computeOpenSlots` ignores the extra param and returns unfiltered results, so the "excludes" assertions fail (still contain the blocked slot).

- [ ] **Step 3: Write the implementation**

In `src/lib/availability.ts`, replace:

```ts
interface ComputeOpenSlotsParams {
  date: string; // "YYYY-MM-DD", the calendar date in the location's timezone
  timezone: string; // IANA zone, e.g. "America/Los_Angeles"
  rules: AvailabilityRule[];
  overrides: SlotOverride[];
  bookedRanges: BookedRange[];
  durationMinutes?: number; // length of a single booking
  stepMinutes?: number; // granularity of offered start times (rolling window)
}
```

with:

```ts
export interface BlockedSlot {
  day_of_week: number | null; // set for a recurring block; null for a date-specific one
  date: string | null; // "YYYY-MM-DD"; set for a date-specific block; null for recurring
  start_time: string; // "HH:MM:SS"
}

interface ComputeOpenSlotsParams {
  date: string; // "YYYY-MM-DD", the calendar date in the location's timezone
  timezone: string; // IANA zone, e.g. "America/Los_Angeles"
  rules: AvailabilityRule[];
  overrides: SlotOverride[];
  bookedRanges: BookedRange[];
  blockedSlots?: BlockedSlot[]; // per-slot blocks, recurring or date-specific
  durationMinutes?: number; // length of a single booking
  stepMinutes?: number; // granularity of offered start times (rolling window)
}
```

Then replace:

```ts
export function computeOpenSlots({
  date,
  timezone,
  rules,
  overrides,
  bookedRanges,
  durationMinutes = 60,
  stepMinutes = 15,
}: ComputeOpenSlotsParams): Slot[] {
  const hours = resolveDayHours(date, rules, overrides);
  if (!hours) return [];

  const openInstant = fromZonedTime(`${date}T${hours.openTime}`, timezone);
  const closeInstant = fromZonedTime(`${date}T${hours.closeTime}`, timezone);

  const bookedMs = bookedRanges.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime(),
  }));

  const slots: Slot[] = [];
  const stepMs = stepMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  for (
    let start = openInstant.getTime();
    start + durationMs <= closeInstant.getTime();
    start += stepMs
  ) {
    const end = start + durationMs;
    const overlapsBooking = bookedMs.some((b) => start < b.end && end > b.start);
    if (!overlapsBooking) {
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }

  return slots;
}
```

with:

```ts
export function computeOpenSlots({
  date,
  timezone,
  rules,
  overrides,
  bookedRanges,
  blockedSlots = [],
  durationMinutes = 60,
  stepMinutes = 15,
}: ComputeOpenSlotsParams): Slot[] {
  const hours = resolveDayHours(date, rules, overrides);
  if (!hours) return [];

  const openInstant = fromZonedTime(`${date}T${hours.openTime}`, timezone);
  const closeInstant = fromZonedTime(`${date}T${hours.closeTime}`, timezone);

  const bookedMs = bookedRanges.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime(),
  }));

  const dow = dayOfWeekFor(date);
  const blockedStarts = new Set(
    blockedSlots
      .filter((b) => b.day_of_week === dow || b.date === date)
      .map((b) => b.start_time.slice(0, 5))
  );
  const openMinutes = parseTimeToMinutes(hours.openTime);

  const slots: Slot[] = [];
  const stepMs = stepMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  let i = 0;
  for (
    let start = openInstant.getTime();
    start + durationMs <= closeInstant.getTime();
    start += stepMs, i++
  ) {
    const end = start + durationMs;
    const overlapsBooking = bookedMs.some((b) => start < b.end && end > b.start);
    const wallStart = formatMinutesAsTime(openMinutes + i * stepMinutes).slice(0, 5);
    const isBlocked = blockedStarts.has(wallStart);
    if (!overlapsBooking && !isBlocked) {
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }

  return slots;
}
```

Note on the `openMinutes + i * stepMinutes` wall-clock computation: this assumes no DST transition occurs mid-window, which is the same simplification `computeOpenSlots` has always made (it already just adds fixed-millisecond `stepMs` to an instant without any DST-aware wall-clock reconciliation) — not a new limitation this task introduces.

**Deliberate deviation from the spec's literal wording:** the spec describes `generateSlotStarts` as "used both internally [in `computeOpenSlots`] and by the admin grid builder." This task does NOT call `generateSlotStarts` directly inside `computeOpenSlots` — it reimplements the equivalent per-iteration wall-clock computation via the same private `formatMinutesAsTime`/`parseTimeToMinutes` helpers instead. Reason: `generateSlotStarts`'s own loop boundary is `m + stepMinutes <= closeMin`, but `computeOpenSlots`'s instant-based loop boundary is `start + durationMs <= closeInstant`. These two boundaries only coincide when `durationMinutes === stepMinutes` — true for this feature's own admin-grid use case, but *not* generally true for `computeOpenSlots` itself (the player-facing booking page already calls it with `durationMinutes === stepMinutes === slot_size_minutes` today, but the function's own default parameters, `durationMinutes = 60, stepMinutes = 15`, show duration and step are meant to be independently variable). Calling `generateSlotStarts` inside `computeOpenSlots` would silently produce a wall-clock array of the wrong length whenever a caller ever passes different duration/step values, misaligning the blocked-slot check against the wrong candidate. The exported API and every observable behavior the spec promised (blocking by day-of-week or exact date, `generateSlotStarts` existing and being usable by the admin grid builder) are unchanged — only the internal wiring inside `computeOpenSlots` differs from the spec's literal phrasing, for correctness.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- availability`
Expected: PASS, 17 tests (11 from Task 2 + 6 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (61 total: 55 from Task 2 + 6 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "Exclude blocked slots (recurring and date-specific) in computeOpenSlots"
```

---

### Task 4: `buildSlotGrid` (`src/lib/blockedSlots.ts`), built test-first

**Files:**
- Create: `src/lib/blockedSlots.ts`
- Test: `src/lib/blockedSlots.test.ts`

**Interfaces:**
- Consumes: `generateSlotStarts` from `@/lib/availability` (Task 2).
- Produces: `export interface SlotBlockState { startTime: string; blocked: boolean }`, `export function buildSlotGrid(openTime: string, closeTime: string, stepMinutes: number, blockedStartTimes: string[]): SlotBlockState[]` — Task 6 imports this exact name.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildSlotGrid } from "@/lib/blockedSlots";

describe("buildSlotGrid", () => {
  it("marks slots as open when nothing is blocked", () => {
    expect(buildSlotGrid("09:00:00", "11:00:00", 60, [])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "10:00:00", blocked: false },
    ]);
  });

  it("marks a matching slot as blocked", () => {
    expect(buildSlotGrid("09:00:00", "11:00:00", 60, ["10:00:00"])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "10:00:00", blocked: true },
    ]);
  });

  it("matches blocked times ignoring seconds precision", () => {
    expect(buildSlotGrid("09:00:00", "10:00:00", 30, ["09:30"])).toEqual([
      { startTime: "09:00:00", blocked: false },
      { startTime: "09:30:00", blocked: true },
    ]);
  });

  it("returns an empty array when the window has no slots", () => {
    expect(buildSlotGrid("09:00:00", "09:00:00", 30, [])).toEqual([]);
  });
});
```

Save this as `src/lib/blockedSlots.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blockedSlots`
Expected: FAIL — `Failed to resolve import "@/lib/blockedSlots"`.

- [ ] **Step 3: Write the implementation**

```ts
import { generateSlotStarts } from "@/lib/availability";

export interface SlotBlockState {
  startTime: string; // "HH:MM:SS"
  blocked: boolean;
}

// Builds the admin grid for one day/date's window: every candidate slot
// start, each flagged blocked or not against the already-fetched list of
// blocked start times for that day/date.
export function buildSlotGrid(
  openTime: string,
  closeTime: string,
  stepMinutes: number,
  blockedStartTimes: string[]
): SlotBlockState[] {
  const blockedSet = new Set(blockedStartTimes.map((t) => t.slice(0, 5)));
  return generateSlotStarts(openTime, closeTime, stepMinutes).map((startTime) => ({
    startTime,
    blocked: blockedSet.has(startTime.slice(0, 5)),
  }));
}
```

Save this as `src/lib/blockedSlots.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blockedSlots`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (65 total: 61 from Task 3 + 4 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/blockedSlots.ts src/lib/blockedSlots.test.ts
git commit -m "Add buildSlotGrid for the admin blocked-slots grid"
```

---

### Task 5: `toggleBlockedSlot` server action

**Files:**
- Modify: `src/app/admin/actions.ts`

**Interfaces:**
- Consumes: `blocked_slots` table (Task 1).
- Produces: `export async function toggleBlockedSlot(formData: FormData)` — Task 6's admin page imports and wires this to each grid-cell form.

- [ ] **Step 1: Add the action**

Add to the end of `src/app/admin/actions.ts`:

```ts
export async function toggleBlockedSlot(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const mode = String(formData.get("mode"));
  const startTime = String(formData.get("start_time"));
  const currentlyBlocked = String(formData.get("currently_blocked")) === "true";

  const supabase = await createClient();

  if (mode === "recurring") {
    const dayOfWeek = Number(formData.get("day_of_week"));

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("blocked_slots")
        .delete()
        .eq("court_id", courtId)
        .eq("day_of_week", dayOfWeek)
        .eq("start_time", startTime);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("blocked_slots")
        .insert({ court_id: courtId, day_of_week: dayOfWeek, start_time: startTime });
      if (error) throw new Error(error.message);
    }

    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(
      `/admin/locations/${locationId}/courts/${courtId}?block_mode=recurring&block_day=${dayOfWeek}`
    );
  } else {
    const date = String(formData.get("date"));

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("blocked_slots")
        .delete()
        .eq("court_id", courtId)
        .eq("date", date)
        .eq("start_time", startTime);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("blocked_slots")
        .insert({ court_id: courtId, date, start_time: startTime });
      if (error) throw new Error(error.message);
    }

    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(`/admin/locations/${locationId}/courts/${courtId}?block_mode=date&block_date=${date}`);
  }
}
```

No new imports needed — `createClient`, `redirect`, and `revalidatePath` are already imported at the top of this file.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "Add toggleBlockedSlot server action"
```

---

### Task 6: Admin "Blocked Slots" section on the per-court admin page

**Files:**
- Modify: `src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx`

**Interfaces:**
- Consumes: `resolveDayHours`, `type AvailabilityRule`, `type SlotOverride` (already imported in this file), `buildSlotGrid` from `@/lib/blockedSlots` (Task 4), `toggleBlockedSlot` from `@/app/admin/actions` (Task 5).
- Produces: nothing new for later tasks — this is a leaf UI addition.

- [ ] **Step 1: Add `slot_size_minutes` to the court query**

Replace:

```tsx
  const { data: court } = await supabase
    .from("courts")
    .select("id, name, location:locations(timezone)")
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();
```

with:

```tsx
  const { data: court } = await supabase
    .from("courts")
    .select("id, name, slot_size_minutes, location:locations(timezone)")
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();
```

- [ ] **Step 2: Add new searchParams fields and destructure them**

Replace:

```tsx
  searchParams: Promise<{
    saved?: string;
    config_saved?: string;
    cancelled?: string;
    override_saved?: string;
    override_deleted?: string;
    override_error?: string;
  }>;
}) {
  const { locationId, courtId } = await params;
  const { saved, config_saved, cancelled, override_saved, override_deleted, override_error } =
    await searchParams;
```

with:

```tsx
  searchParams: Promise<{
    saved?: string;
    config_saved?: string;
    cancelled?: string;
    override_saved?: string;
    override_deleted?: string;
    override_error?: string;
    block_mode?: string;
    block_day?: string;
    block_date?: string;
  }>;
}) {
  const { locationId, courtId } = await params;
  const {
    saved,
    config_saved,
    cancelled,
    override_saved,
    override_deleted,
    override_error,
    block_mode: blockModeParam,
    block_day: blockDayParam,
    block_date: blockDateParam,
  } = await searchParams;
```

- [ ] **Step 3: Update the imports**

Replace:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  saveAvailability,
  updateBookingConfig,
  saveSlotOverride,
  deleteSlotOverride,
} from "@/app/admin/actions";
import { cancelBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate, formatCalendarDate, formatTimeOfDay } from "@/lib/dateFormat";
import SuccessBanner from "@/components/SuccessBanner";
```

with:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  saveAvailability,
  updateBookingConfig,
  saveSlotOverride,
  deleteSlotOverride,
  toggleBlockedSlot,
} from "@/app/admin/actions";
import { cancelBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate, formatCalendarDate, formatTimeOfDay } from "@/lib/dateFormat";
import { resolveDayHours, type AvailabilityRule, type SlotOverride } from "@/lib/availability";
import { buildSlotGrid } from "@/lib/blockedSlots";
import SuccessBanner from "@/components/SuccessBanner";
```

- [ ] **Step 4: Compute the blocked-slots view state and fetch its data**

After the existing block that fetches `overrides` and builds `rulesByDay` (i.e. right after `const rulesByDay = new Map((rules ?? []).map((r) => [r.day_of_week, r]));` and the `overrides` query that follows it, but BEFORE the `upcomingBookings` query), insert:

```tsx
  const blockMode = blockModeParam === "date" ? "date" : "recurring";
  const todayDateStr = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const todayDayOfWeek = new Date(`${todayDateStr}T12:00:00Z`).getUTCDay();
  const blockDay = blockDayParam ? Number(blockDayParam) : todayDayOfWeek;
  const blockDate = blockDateParam ?? todayDateStr;
  const slotSizeMinutes = court.slot_size_minutes ?? 60;

  let blockWindow: { openTime: string; closeTime: string } | null = null;
  if (blockMode === "recurring") {
    const rule = rulesByDay.get(blockDay);
    blockWindow = rule ? { openTime: rule.open_time, closeTime: rule.close_time } : null;
  } else {
    blockWindow = resolveDayHours(
      blockDate,
      (rules ?? []) as AvailabilityRule[],
      (overrides ?? []) as SlotOverride[]
    );
  }

  const { data: blockedSlotRows } =
    blockMode === "recurring"
      ? await supabase
          .from("blocked_slots")
          .select("start_time")
          .eq("court_id", court.id)
          .eq("day_of_week", blockDay)
      : await supabase
          .from("blocked_slots")
          .select("start_time")
          .eq("court_id", court.id)
          .eq("date", blockDate);

  const slotGrid = blockWindow
    ? buildSlotGrid(
        blockWindow.openTime,
        blockWindow.closeTime,
        slotSizeMinutes,
        (blockedSlotRows ?? []).map((r) => r.start_time)
      )
    : [];
```

(This uses `timezone`, which the file already computes earlier as `const timezone = location?.timezone ?? "UTC";` — no new variable needed for that.)

- [ ] **Step 5: Add the "Blocked Slots" section to the JSX**

Insert this new section right after the closing `</form>` of the existing "Add Override" form and right before `<h2 className="mt-10 text-lg font-medium">Upcoming Bookings</h2>`:

```tsx
      <h2 className="mt-10 text-lg font-medium">Blocked Slots</h2>
      <p className="mt-1 text-sm text-gray-600">
        Block off specific times within the hours above — a recurring break, or a one-off
        private event.
      </p>

      <div className="mt-3 flex gap-4 text-sm">
        <Link
          href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=recurring&block_day=${blockDay}`}
          className={blockMode === "recurring" ? "font-medium underline" : "text-gray-600 underline"}
        >
          Recurring
        </Link>
        <Link
          href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=date&block_date=${blockDate}`}
          className={blockMode === "date" ? "font-medium underline" : "text-gray-600 underline"}
        >
          Specific date
        </Link>
      </div>

      {blockMode === "recurring" ? (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {DAY_NAMES.map((name, day) => (
            <Link
              key={day}
              href={`/admin/locations/${locationId}/courts/${court.id}?block_mode=recurring&block_day=${day}`}
              className={`rounded border px-2 py-1 ${
                day === blockDay ? "border-black font-medium" : "border-gray-300 text-gray-600"
              }`}
            >
              {name.slice(0, 3)}
            </Link>
          ))}
        </div>
      ) : (
        <form method="get" className="mt-3 flex items-end gap-2">
          <input type="hidden" name="block_mode" value="date" />
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Date
            <input
              type="date"
              name="block_date"
              defaultValue={blockDate}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="rounded border border-gray-400 px-3 py-2 text-sm">
            View
          </button>
        </form>
      )}

      {blockWindow ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {slotGrid.map((slot) => (
            <form key={slot.startTime} action={toggleBlockedSlot}>
              <input type="hidden" name="court_id" value={court.id} />
              <input type="hidden" name="location_id" value={locationId} />
              <input type="hidden" name="mode" value={blockMode} />
              <input type="hidden" name="start_time" value={slot.startTime} />
              <input type="hidden" name="currently_blocked" value={String(slot.blocked)} />
              {blockMode === "recurring" ? (
                <input type="hidden" name="day_of_week" value={blockDay} />
              ) : (
                <input type="hidden" name="date" value={blockDate} />
              )}
              <button
                type="submit"
                className={`rounded border px-3 py-2 text-sm ${
                  slot.blocked ? "border-red-400 bg-red-50 text-red-800" : "border-gray-300"
                }`}
              >
                {formatTimeOfDay(slot.startTime)}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          {blockMode === "recurring"
            ? "This day is closed in the weekly schedule."
            : "This date is closed."}
        </p>
      )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manually verify in the browser**

With the dev server running: go to a court's admin page, confirm the new "Blocked Slots" section renders under "Date Overrides." In Recurring mode, click a day with hours set, confirm a grid of time buttons appears; click one to block it (button turns red, page redirects back to the same day), click it again to unblock. Switch to "Specific date," pick a date, confirm the grid reflects that date's hours (including a date with a `slot_overrides` custom-hours entry, if you have one, to confirm `resolveDayHours` is being used correctly). Pick a day with no weekly rule and confirm the "closed" message shows instead of a grid.

- [ ] **Step 8: Commit**

```bash
git add "src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx"
git commit -m "Add Blocked Slots admin UI section"
```

---

### Task 7: Wire `blockedSlots` into the player-facing court page

**Files:**
- Modify: `src/app/locations/[locationId]/courts/[courtId]/page.tsx`

**Interfaces:**
- Consumes: `dayOfWeekFor`, `type BlockedSlot` from `@/lib/availability` (Tasks 2, 3).
- Produces: nothing new for later tasks — this is the last functional piece; after it lands, a block created in Task 6's admin UI actually affects what players can book.

- [ ] **Step 1: Update the import**

Replace:

```tsx
import {
  computeOpenSlots,
  resolveDayHours,
  type AvailabilityRule,
  type SlotOverride,
} from "@/lib/availability";
```

with:

```tsx
import {
  computeOpenSlots,
  resolveDayHours,
  dayOfWeekFor,
  type AvailabilityRule,
  type SlotOverride,
  type BlockedSlot,
} from "@/lib/availability";
```

- [ ] **Step 2: Fetch blocked slots and pass them to `computeOpenSlots`**

Replace:

```tsx
  const [{ data: rules }, { data: overrides }, { data: booked_slots }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("day_of_week, open_time, close_time")
      .eq("court_id", court.id),
    supabase
      .from("slot_overrides")
      .select("date, is_closed, custom_open, custom_close")
      .eq("court_id", court.id)
      .eq("date", date),
    supabase.from("booked_slots").select("start_time, end_time").eq("court_id", court.id),
  ]);

  const slotSizeMinutes = court.slot_size_minutes ?? 60;

  const slots = computeOpenSlots({
    date,
    timezone,
    rules: (rules ?? []) as AvailabilityRule[],
    overrides: (overrides ?? []) as SlotOverride[],
    bookedRanges: booked_slots ?? [],
    durationMinutes: slotSizeMinutes,
    stepMinutes: slotSizeMinutes,
  });
```

with:

```tsx
  const dow = dayOfWeekFor(date);

  const [{ data: rules }, { data: overrides }, { data: booked_slots }, { data: blocked_slots }] =
    await Promise.all([
      supabase
        .from("availability_rules")
        .select("day_of_week, open_time, close_time")
        .eq("court_id", court.id),
      supabase
        .from("slot_overrides")
        .select("date, is_closed, custom_open, custom_close")
        .eq("court_id", court.id)
        .eq("date", date),
      supabase.from("booked_slots").select("start_time, end_time").eq("court_id", court.id),
      supabase
        .from("blocked_slots")
        .select("day_of_week, date, start_time")
        .eq("court_id", court.id)
        .or(`day_of_week.eq.${dow},date.eq.${date}`),
    ]);

  const slotSizeMinutes = court.slot_size_minutes ?? 60;

  const slots = computeOpenSlots({
    date,
    timezone,
    rules: (rules ?? []) as AvailabilityRule[],
    overrides: (overrides ?? []) as SlotOverride[],
    bookedRanges: booked_slots ?? [],
    blockedSlots: (blocked_slots ?? []) as BlockedSlot[],
    durationMinutes: slotSizeMinutes,
    stepMinutes: slotSizeMinutes,
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify in the browser end-to-end**

As admin, block a specific recurring slot on today's day-of-week for a real court (via Task 6's UI). Then, signed out or as a player, visit that court's booking page for a date on that day-of-week and confirm the blocked time no longer appears in the slot grid, while adjacent times still do. Unblock it and confirm it comes back. Repeat once for a one-off date block: block a slot for one specific future date, confirm it's missing only on that exact date (present on the same weekday the following week), then unblock and confirm it returns.

- [ ] **Step 5: Commit**

```bash
git add "src/app/locations/[locationId]/courts/[courtId]/page.tsx"
git commit -m "Pass blocked slots into the player-facing court booking page"
```

---

### Task 8: End-to-end verification + status log update

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation + final verification only).

- [ ] **Step 1: Full walkthrough covering both modes together**

With all prior tasks landed, on one real court: block a recurring slot on a day-of-week, block a one-off slot on a specific date that falls on a *different* day-of-week than the recurring block, and confirm both work independently and simultaneously (recurring block affects every occurrence of that weekday; date block affects only its one date) by checking the player-facing page across a few different dates. Also confirm blocking a slot that already has a confirmed booking doesn't error and doesn't touch the booking (create a test booking first if none exists, block its slot, confirm the booking is untouched in `/bookings` or the admin "Upcoming Bookings" list, then clean up — cancel the test booking and unblock the slot afterward).

- [ ] **Step 2: Run the full verification suite**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (65 total), no type errors.

- [ ] **Step 3: Update the status log**

In `CLAUDE.md`, find the existing unchecked bullet:

```
- [ ] Availability reconfiguration -- rework `availability_rules` from a single open/close block per day into: an admin sets general open hours for the day, then can individually block or re-enable specific 30-min slots within that window (rather than the whole window being uniformly open). Needs a data model change -- likely a new per-court, per-slot table (extending or alongside `slot_overrides`, which currently only does whole-day closures or a single custom open/close override, not per-slot granularity) -- and a corresponding change to `computeOpenSlots` in `src/lib/availability.ts` to also exclude explicitly-blocked slots.
```

Immediately after it, add a new checked entry:

```markdown
- [x] Superseded above: per-slot availability blocking shipped, both recurring (by day-of-week) and one-off (by specific date), sharing a single new `blocked_slots` table (`supabase/migrations/0014_blocked_slots.sql`) and a single new "Blocked Slots" admin UI section rather than two separate mechanisms -- a row's `day_of_week` XOR `date` decides which mode it belongs to. Block granularity always matches the court's own `slot_size_minutes` (not a hardcoded 30 minutes, since the backlog note's literal wording didn't account for 60-min courts). `computeOpenSlots` (`src/lib/availability.ts`) gained a `blockedSlots` param and now excludes any candidate whose wall-clock start matches a blocked entry for that day-of-week or exact date, built on a new shared `generateSlotStarts` helper (also used by the new admin grid-builder, `buildSlotGrid` in `src/lib/blockedSlots.ts`) -- both built test-first. The admin section (on the existing per-court page, alongside Weekly Availability and Date Overrides) uses a query-param-driven mode/day/date picker (no client component, matching this app's established convention) and a grid of small per-slot toggle forms, the same immediate-click feel as the player booking grid but without a shared client component, since blocks don't need contiguous-selection semantics. `blocked_slots` was made public-select (`using (true)`) from day one, learning from the earlier gap where `availability_rules`/`slot_overrides` needed a follow-up migration to fix exactly this. Blocking never touches existing bookings, matching how `slot_overrides.is_closed` already worked -- manually verified a slot with a live booking can be blocked without error or any change to the booking. Manually verified end-to-end: a recurring block affects every occurrence of that weekday and nothing else; a one-off date block affects only that exact date, including on a different weekday than a simultaneously-active recurring block; both unblock cleanly.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Update status log: per-slot availability blocking shipped"
```
