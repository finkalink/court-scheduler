# Open Court Public Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give logged-out visitors a real marketing landing page at `/` (hero + how-it-works + featured events/clubs, in the bold Open Court color-block style), while every logged-in path stays byte-for-byte unchanged.

**Architecture:** Two new tested pure data-shaping functions in `src/lib/cityGrouping.ts`; a new self-contained async server component `LandingPage` (same pattern as existing `CityContent`/`AllCitiesContent`); a one-line branch in `src/app/page.tsx` on `user`; a `filterQuery` prop added to `AllCitiesContent` so the hero's search bar lands somewhere real (`/cities?q=`).

**Tech Stack:** Next.js App Router (server components), Supabase, Tailwind v4 (existing Open Court token classes — `bg-card`, `border-border`, `text-fg`, `text-fg-muted`, `bg-accent`, `text-accent-fg`, `bg-status`, `text-status-fg`, `font-display`), Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-07-open-court-landing-page-design.md](../specs/2026-09-07-open-court-landing-page-design.md)

## Global Constraints

- No new npm dependencies (no icon library, no new fonts) — reuse existing tokens/fonts only.
- The hero band and the "punch" club cards use the one deliberate non-token color in this feature: literal `bg-[#1E293B]` (matches light mode's `--fg` value, but must NOT use the `--fg`/`bg-fg` token, since that token flips with the light/dark toggle and this hero must stay fixed-dark in both modes).
- Every other color in this feature must be an existing token class — no other new hex literals.
- Logged-in user flows (`CityContent`, resolved-city rendering, `AllCitiesContent` with no `filterQuery`) must remain pixel-identical to their current behavior.
- `npm test` after each task.

---

### Task 1: Data layer — `featuredClubs` and `filterCitiesByQuery`

**Files:**
- Modify: `src/lib/cityGrouping.ts`
- Test: `src/lib/cityGrouping.test.ts`

**Interfaces:**
- Produces: `FeaturedClub` type (`{ orgId: string; orgName: string; city: string | null; locationCount: number }`), `featuredClubs<T extends { city: string | null; orgId: string; orgName: string }>(locations: T[], limit: number): FeaturedClub[]`, `filterCitiesByQuery(cities: CityGroup[], query: string): CityGroup[]` — both exported from `src/lib/cityGrouping.ts`, consumed by Task 3 (`LandingPage`) and Task 2 (`AllCitiesContent`) respectively.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/cityGrouping.test.ts` (matching the existing test file's style — check its top for how it imports/structures fixtures before adding):

```ts
import { featuredClubs, filterCitiesByQuery } from "./cityGrouping";

describe("featuredClubs", () => {
  it("dedupes by orgId, summing locationCount", () => {
    const locations = [
      { city: "Westminster", orgId: "a", orgName: "Ace Volleyball" },
      { city: "Westminster", orgId: "a", orgName: "Ace Volleyball" },
      { city: "Camden", orgId: "b", orgName: "Spike Zone" },
    ];
    const result = featuredClubs(locations, 10);
    expect(result).toEqual([
      { orgId: "a", orgName: "Ace Volleyball", city: "Westminster", locationCount: 2 },
      { orgId: "b", orgName: "Spike Zone", city: "Camden", locationCount: 1 },
    ]);
  });

  it("sorts alphabetically by orgName", () => {
    const locations = [
      { city: "A", orgId: "z", orgName: "Zebra Club" },
      { city: "B", orgId: "a", orgName: "Ace Club" },
    ];
    const result = featuredClubs(locations, 10);
    expect(result.map((c) => c.orgId)).toEqual(["a", "z"]);
  });

  it("respects the limit", () => {
    const locations = [
      { city: "A", orgId: "1", orgName: "One" },
      { city: "B", orgId: "2", orgName: "Two" },
      { city: "C", orgId: "3", orgName: "Three" },
    ];
    expect(featuredClubs(locations, 2)).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(featuredClubs([], 5)).toEqual([]);
  });
});

describe("filterCitiesByQuery", () => {
  const cities = [
    { city: "City of Westminster", clubCount: 2 },
    { city: "Camden", clubCount: 1 },
  ];

  it("filters case-insensitively by substring", () => {
    expect(filterCitiesByQuery(cities, "west")).toEqual([
      { city: "City of Westminster", clubCount: 2 },
    ]);
  });

  it("returns all cities unchanged for an empty query", () => {
    expect(filterCitiesByQuery(cities, "")).toEqual(cities);
  });

  it("returns all cities unchanged for a whitespace-only query", () => {
    expect(filterCitiesByQuery(cities, "   ")).toEqual(cities);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCitiesByQuery(cities, "nowhere")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- cityGrouping`
Expected: FAIL — `featuredClubs`/`filterCitiesByQuery` are not exported yet.

- [ ] **Step 3: Implement**

Append to `src/lib/cityGrouping.ts`:

```ts
export interface FeaturedClub {
  orgId: string;
  orgName: string;
  city: string | null;
  locationCount: number;
}

// Distinct clubs across every city (not filtered to one), sorted
// alphabetically, capped to `limit`. Used by the landing page's
// "Featured clubs" section -- a global sample, not a per-city list.
export function featuredClubs<T extends { city: string | null; orgId: string; orgName: string }>(
  locations: T[],
  limit: number
): FeaturedClub[] {
  const countByClub = new Map<string, FeaturedClub>();
  for (const location of locations) {
    const existing = countByClub.get(location.orgId);
    if (existing) {
      existing.locationCount += 1;
    } else {
      countByClub.set(location.orgId, {
        orgId: location.orgId,
        orgName: location.orgName,
        city: location.city,
        locationCount: 1,
      });
    }
  }
  return Array.from(countByClub.values())
    .sort((a, b) => a.orgName.localeCompare(b.orgName))
    .slice(0, limit);
}

// Case-insensitive substring filter over already-grouped city counts, for
// the hero search's `?q=` param. Empty/whitespace query returns `cities`
// unchanged.
export function filterCitiesByQuery(cities: CityGroup[], query: string): CityGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return cities;
  return cities.filter((c) => c.city.toLowerCase().includes(trimmed));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- cityGrouping`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cityGrouping.ts src/lib/cityGrouping.test.ts
git commit -m "Add featuredClubs and filterCitiesByQuery for the landing page"
```

---

### Task 2: Wire city search into `AllCitiesContent` and `/cities`

**Files:**
- Modify: `src/components/AllCitiesContent.tsx`
- Modify: `src/app/cities/page.tsx`
- Test: `src/components/AllCitiesContent.test.tsx` (check whether this file already exists — if not, create it; if it does, add to it following its existing mock/fixture style)

**Interfaces:**
- Consumes: `filterCitiesByQuery(cities: CityGroup[], query: string): CityGroup[]` from Task 1.
- Produces: `AllCitiesContent({ filterQuery }: { filterQuery?: string })` — `filterQuery` is optional and defaults to no filtering, so every existing call site (`src/app/page.tsx`'s `<AllCitiesContent />`) keeps working unmodified. Consumed directly by Task 4's `page.tsx` (which continues calling it with no props) and by this task's own `cities/page.tsx`.

- [ ] **Step 1: Write the failing test**

First check if `src/components/AllCitiesContent.test.tsx` exists (`ls src/components/AllCitiesContent.test.tsx`). If it exists, read it fully to match its existing Supabase-mocking pattern before adding this test. If it does not exist, create it using the same mocking pattern as `src/components/CityContent.test.tsx` (read that file first for the pattern), with at least this case added to (or as) the suite:

```tsx
it("hides a city that does not match filterQuery", async () => {
  // Arrange the mocked Supabase client's locations response to include
  // two cities, e.g. "City of Westminster" and "Camden" (follow this
  // file's/CityContent.test.tsx's existing mock-building helper).
  const ui = await AllCitiesContent({ filterQuery: "west" });
  render(ui);
  expect(screen.getByText("City of Westminster")).toBeInTheDocument();
  expect(screen.queryByText("Camden")).not.toBeInTheDocument();
});
```

(Adapt the exact fixture-building calls to whatever helper `CityContent.test.tsx` already uses for mocking `createClient()` — do not invent a new mocking approach.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AllCitiesContent`
Expected: FAIL — `filterQuery` prop doesn't exist / has no effect yet.

- [ ] **Step 3: Implement**

In `src/components/AllCitiesContent.tsx`:

1. Add the import: `import { groupLocationsByCity, filterCitiesByQuery } from "@/lib/cityGrouping";` (merge with the existing `groupLocationsByCity` import line rather than duplicating it).
2. Change the function signature from `export default async function AllCitiesContent() {` to `export default async function AllCitiesContent({ filterQuery }: { filterQuery?: string } = {}) {`.
3. Right after the existing line `const { cities, otherLocations } = groupLocationsByCity(uniqueLocations);`, add:

```ts
const filteredCities = filterCitiesByQuery(cities, filterQuery ?? "");
```

4. Change every subsequent reference to `cities` in the JSX (the `cities.length === 0` check and the `cities.map(...)` call) to `filteredCities` instead. Leave `sortedOtherLocations` and its rendering untouched.

In `src/app/cities/page.tsx`, replace the whole file with:

```tsx
import AllCitiesContent from "@/components/AllCitiesContent";

export default async function CitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
      <AllCitiesContent filterQuery={q} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- AllCitiesContent`
Expected: PASS (existing tests unaffected since `filterQuery` defaults to filtering nothing; new test passes)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions elsewhere — `src/app/page.tsx` still calls `<AllCitiesContent />` with no props at this point in the plan)

- [ ] **Step 6: Commit**

```bash
git add src/components/AllCitiesContent.tsx src/components/AllCitiesContent.test.tsx src/app/cities/page.tsx
git commit -m "Add city search filtering to AllCitiesContent and /cities"
```

---

### Task 3: `LandingPage` component

**Files:**
- Create: `src/components/LandingPage.tsx`
- Test: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `featuredClubs` from Task 1 (`src/lib/cityGrouping.ts`); `sortBySoonestSession` from `src/lib/eventGrouping.ts` (already exists); `EVENT_TYPE_LABELS` from `src/lib/eventTypes.ts` (already exists); `createClient` from `src/lib/supabase/server.ts` (already exists).
- Produces: `export default async function LandingPage(): Promise<JSX.Element>` — a self-contained async server component taking no props, consumed by Task 4 (`src/app/page.tsx`).

- [ ] **Step 1: Write the failing tests**

Read `src/components/CityContent.test.tsx` first to copy its exact Supabase-client-mocking helper/pattern (this test needs the same style of mock — two tables queried: `events` and `locations`). Create `src/components/LandingPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LandingPage from "./LandingPage";
// Import/build the same createClient mock helper CityContent.test.tsx uses.

describe("LandingPage", () => {
  it("renders the hero headline and search form", async () => {
    // Arrange the mock to return empty events and empty locations.
    const ui = await LandingPage();
    render(ui);
    expect(screen.getByText("court.")).toBeInTheDocument();
    const form = screen.getByPlaceholderText("City of Westminster").closest("form");
    expect(form).toHaveAttribute("action", "/cities");
    expect(form).toHaveAttribute("method", "get");
  });

  it("renders upcoming events and featured clubs when data exists", async () => {
    // Arrange the mock: one event with a future session, one location.
    // Use fixture shapes matching CityContent.test.tsx's existing fixtures
    // (id, title, event_type, location:{city}, event_sessions:[{start_time}]
    // for events; id, city, organization:{id,name}, courts:[{id,is_active}]
    // for locations).
    const ui = await LandingPage();
    render(ui);
    expect(screen.getByText("Upcoming events")).toBeInTheDocument();
    expect(screen.getByText("Featured clubs")).toBeInTheDocument();
  });

  it("omits the events and clubs sections entirely when there is no data", async () => {
    // Arrange the mock to return empty arrays for both tables.
    const ui = await LandingPage();
    render(ui);
    expect(screen.queryByText("Upcoming events")).not.toBeInTheDocument();
    expect(screen.queryByText("Featured clubs")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- LandingPage`
Expected: FAIL — `./LandingPage` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/components/LandingPage.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { featuredClubs } from "@/lib/cityGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function LandingPage() {
  const supabase = await createClient();

  const [{ data: allEvents }, { data: locations }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
      .neq("status", "draft")
      .neq("status", "cancelled"),
    supabase
      .from("locations")
      .select("id, city, organization:organizations(id, name), courts!inner(id, is_active)")
      .eq("courts.is_active", true),
  ]);

  const mappedEvents = (allEvents ?? []).map((e) => {
    const eventLocation = Array.isArray(e.location) ? e.location[0] : e.location;
    return {
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      city: eventLocation?.city ?? null,
      sessions: e.event_sessions,
    };
  });
  const upcomingEvents = sortBySoonestSession(mappedEvents, new Date()).slice(0, 3);

  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .map((l) => {
      const org = Array.isArray(l.organization) ? l.organization[0] : l.organization;
      return { id: l.id, city: l.city, orgId: org?.id ?? "", orgName: org?.name ?? "" };
    });
  const clubs = featuredClubs(uniqueLocations, 3);

  return (
    <div>
      <section className="relative overflow-hidden bg-[#1E293B] px-4 py-16 sm:px-6 sm:py-24">
        <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent/15" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-link/15" />
        <div className="relative mx-auto max-w-3xl">
          <p className="font-display text-sm uppercase tracking-[0.15em] text-accent">
            Volleyball, your city, your court
          </p>
          <h1 className="font-display mt-4 text-6xl uppercase leading-[0.95] tracking-wide text-white sm:text-7xl">
            Own the
            <br />
            <span className="text-accent">court.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-white/65">
            Book courts, join tournaments, and track every game across the clubs near you.
          </p>
          <form action="/cities" method="get" className="mt-8 flex max-w-md gap-2">
            <input
              type="text"
              name="q"
              placeholder="City of Westminster"
              className="h-12 flex-1 rounded-lg border-0 bg-white/10 px-4 text-sm text-white placeholder:text-white/50 focus:outline-2 focus:outline-accent"
            />
            <button
              type="submit"
              className="h-12 rounded-lg bg-accent px-6 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto grid max-w-3xl grid-cols-3 gap-4 px-4 py-10 sm:px-6">
        {[
          { n: "1", label: "Find a court", body: "Browse clubs near you" },
          { n: "2", label: "Book a slot", body: "Pick a time that works" },
          { n: "3", label: "Play", body: "Show up and compete" },
        ].map((step) => (
          <div key={step.n} className="text-center">
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-status text-sm font-medium text-status-fg">
              {step.n}
            </div>
            <p className="mt-2 text-sm font-medium text-fg">{step.label}</p>
            <p className="text-xs text-fg-muted">{step.body}</p>
          </div>
        ))}
      </section>

      {upcomingEvents.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
          <p className="mb-3 text-sm font-medium text-fg">Upcoming events</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcomingEvents.map((event, i) => (
              <div key={event.id} className="relative">
                <div
                  className={`absolute inset-0 translate-x-2 translate-y-2 rounded-xl ${
                    i === 0 ? "bg-accent/40" : "bg-fg-muted/30"
                  }`}
                />
                <Link
                  href={`/events/${event.id}`}
                  className="relative block rounded-xl border-2 border-fg bg-card p-5"
                >
                  <p className="mb-2 inline-block rounded-full bg-status px-3 py-0.5 text-xs font-medium text-status-fg">
                    {EVENT_TYPE_LABELS[event.eventType]}
                  </p>
                  <p className="text-lg font-medium text-fg">{event.title}</p>
                  {event.city && <p className="text-sm text-fg-muted">{event.city}</p>}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {clubs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <p className="mb-3 text-sm font-medium text-fg">Featured clubs</p>
          <div className="grid grid-cols-3 gap-3">
            {clubs.map((club, i) => (
              <Link
                key={club.orgId}
                href={`/clubs/${club.orgId}`}
                className={`rounded-xl p-4 ${
                  i === 1 ? "bg-accent text-accent-fg" : "bg-[#1E293B] text-white"
                }`}
              >
                <p className="text-sm font-medium">{club.orgName}</p>
                <p className={`text-xs ${i === 1 ? "text-accent-fg/70" : "text-white/55"}`}>
                  {club.locationCount} location{club.locationCount === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- LandingPage`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LandingPage.test.tsx
git commit -m "Add LandingPage component for logged-out visitors"
```

---

### Task 4: Wire `LandingPage` into `/`

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `LandingPage` (default export, no props) from Task 3.

- [ ] **Step 1: Implement**

In `src/app/page.tsx`, add the import `import LandingPage from "@/components/LandingPage";` alongside the existing component imports, and change:

```tsx
  if (!resolvedCity) {
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
        <AllCitiesContent />
      </div>
    );
  }
```

to:

```tsx
  if (!resolvedCity) {
    if (!user) {
      return <LandingPage />;
    }
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
        <AllCitiesContent />
      </div>
    );
  }
```

No other changes to this file — `user` is already destructured earlier in the function from `supabase.auth.getUser()`.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS (no test file targets `page.tsx` directly, per this codebase's convention of verifying server-component routing live rather than unit-testing it — see spec's Testing plan)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Start the dev server and check, per the spec's Manual verification plan:
- Logged out (or in an incognito/private context with no session), no city cookie: `/` shows the new landing page.
- If a logged-in test session is available: `/` still shows `AllCitiesContent` (or `CityContent`, if that account has a resolved city) — completely unchanged.
- Hero search with a real city substring lands on `/cities?q=...` filtered correctly.
- Resize to mobile width: no horizontal scroll, offset-stacked cards don't overlap or clip.
- Toggle light/dark: hero band and club "punch" cards stay fixed dark navy in both modes; everything else follows the toggle.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "Show the Open Court landing page to logged-out visitors on /"
```
