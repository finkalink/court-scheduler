# Open Court Public Landing Page — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-07

## Goal

Give logged-out visitors a real marketing landing page at `/`, instead of
today's bare "Find a Court" heading over a plain city list. Logged-in
users are unaffected — they keep the existing functional flow (resolved
city → `CityContent`, or no default city yet → `AllCitiesContent`).

Visual direction confirmed via mockup (three variants reviewed; the "bold
light color-block" variant was picked): a fixed dark-navy hero band
(independent of the app's own light/dark toggle — a marketing-page
convention) with translucent accent-colored circles, an oversized
`font-display` headline, and a city-search bar bleeding into a light body
below. Event and club cards below the hero use an "offset-stacked panel"
treatment — a solid color panel positioned a few pixels behind each card —
for a layered look without relying on blur/shadow.

This spec reuses the Open Court token system and typography exactly as
shipped (`docs/superpowers/specs/2026-09-07-open-court-retheme-design.md`)
— no new tokens, no new fonts. `AppShell`'s existing top nav still renders
above this page; the landing page itself starts below the header.

## Non-goals

- **No changes for logged-in users.** `CityContent` and `AllCitiesContent`
  keep their current behavior and styling untouched.
- **No new theme tokens.** The hero's fixed dark background is a literal
  color (`#1E293B`, the same hex as light mode's `--fg`), not a new
  token — it does not change with the light/dark toggle, by design (see
  Goal above). Everything else on the page uses existing tokens.
- **No fuzzy/typeahead city search.** The hero search is a plain GET form
  to `/cities?q=<text>`, which server-side substring-filters the existing
  city list. No client-side JS, no autocomplete dropdown.
- **No new icon library.** "How it works" steps use numbered circles
  (`1`/`2`/`3` in `bg-status`/`text-status-fg`), matching this codebase's
  existing no-icon-dependency convention.
- **No image assets.** All visual interest comes from color, type, and
  layout — consistent with the rest of the app (no photography anywhere
  today).

## Data

Two new pure functions, both unit-tested (existing `src/lib/cityGrouping.ts`
pattern):

```ts
// src/lib/cityGrouping.ts additions

export interface FeaturedClub {
  orgId: string;
  orgName: string;
  city: string | null;
  locationCount: number;
}

// Distinct clubs across every city (not filtered to one), sorted
// alphabetically, capped to `limit`. Used by the landing page's
// "Featured clubs" section — a global sample, not a per-city list.
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

`LandingPage` fetches its own data (same self-contained-async-server-component
pattern as `CityContent`/`AllCitiesContent`):

- Events: same `events` query `CityContent` already runs (`id, title,
  event_type, location:locations(city), event_sessions(start_time)`,
  excluding `draft`/`cancelled`), but **without** the city filter — pass
  the full mapped list straight to `sortBySoonestSession`, take the first
  3.
- Clubs: same `locations` query `AllCitiesContent` already runs, deduped
  the same way, passed through the new `featuredClubs(..., 3)`.

## Routing

`src/app/page.tsx`'s existing `!resolvedCity` branch splits on `user`:

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

A logged-in user who happens to have no resolved city yet (new account,
no `default_city`, no override cookie) still sees the functional
`AllCitiesContent` picker, not the marketing page — they're already
inside the app.

`src/app/cities/page.tsx` and `AllCitiesContent` gain an optional search
param, so the hero's "Search" button lands somewhere real:

```tsx
// src/app/cities/page.tsx
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

`AllCitiesContent` accepts `filterQuery?: string`, applies
`filterCitiesByQuery(cities, filterQuery ?? "")` to the `cities` array
(from `groupLocationsByCity`) right before rendering the list.
`sortedOtherLocations` is unaffected — this filters known cities only.

## File structure

```
src/lib/cityGrouping.ts          -- MODIFY: add featuredClubs, filterCitiesByQuery
src/lib/cityGrouping.test.ts     -- MODIFY: tests for both new functions
src/components/LandingPage.tsx   -- NEW: hero + how-it-works + featured events/clubs
src/components/LandingPage.test.tsx -- NEW: RTL smoke test
src/app/page.tsx                 -- MODIFY: branch on `user` in the !resolvedCity case
src/components/AllCitiesContent.tsx -- MODIFY: accept + apply filterQuery prop
src/app/cities/page.tsx          -- MODIFY: read searchParams.q, pass to AllCitiesContent
```

## `src/components/LandingPage.tsx`

Structure (all using existing tokens except the hero's fixed dark bg):

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
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
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
              className="h-12 flex-1 rounded-lg border-0 bg-white/10 px-4 text-sm text-white placeholder:text-white/60 focus:outline-2 focus:outline-accent"
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
                <p className={`text-xs ${i === 1 ? "text-accent-fg" : "text-white/55"}`}>
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

Notes on the above:

- The middle featured-club card (`i === 1`) always renders solid-accent
  regardless of which club lands there — matches the mockup's punch-card
  treatment. With fewer than 2 clubs this simply never triggers.
- Event card stacking (`i === 0` gets the accent-tinted offset panel,
  others get a muted one) mirrors the mockup's two-tone stacked pair;
  with 3 events the third also gets the muted treatment.
- `bg-[#1E293B]` (hero, club cards) is the one deliberate departure from
  pure token classes in this codebase, and it's intentional per Non-goals
  above — every other color on the page is a token class.

## Testing plan

- `featuredClubs` — unit tests: dedupes by `orgId` summing `locationCount`,
  sorts alphabetically, respects `limit`, empty input → empty array.
- `filterCitiesByQuery` — unit tests: case-insensitive substring match,
  empty/whitespace query returns input unchanged, no match → empty array.
- `LandingPage` — RTL smoke test with a mocked Supabase client: renders
  the headline, the search form (with the correct `action`/`method`/`name`
  attributes), and — given fixture events/clubs — the "Upcoming events"
  and "Featured clubs" section headings. A second case with empty
  events/clubs confirms those two `section`s don't render at all (the
  `.length > 0` guards).
- `AllCitiesContent` — existing tests still pass with `filterQuery`
  omitted (defaults to no filtering); one new test asserts a city outside
  the `filterQuery` substring is not rendered.
- `page.tsx` — no new automated test (this codebase's established
  convention: server-component routing/composition is verified live, not
  unit-tested — same call Phase 1 made for `layout.tsx`'s cookie
  reading). Covered by the manual verification plan below instead.

## Manual verification plan

- Logged out, no city cookie: `/` shows the new hero landing page, not
  the old plain heading + city list.
- Logged in (with or without a `default_city`) but no resolved city:
  `/` still shows the existing `AllCitiesContent` picker — landing page
  never appears for an authenticated session.
- Logged in with a resolved city: `/` is completely unchanged
  (`CityContent`, same as today).
- Type a real city substring into the hero search, click Search: lands on
  `/cities?q=<text>` with only matching cities shown.
- Type a non-matching string: `/cities?q=...` shows zero cities in the
  known-cities list (existing "no locations" empty state still applies to
  `otherLocations`, which isn't filtered).
- Submit the hero search with an empty field: behaves identically to
  clicking a plain "see all cities" link (empty `q` == unfiltered).
- Resize to mobile width (375px): hero, how-it-works, and card grids all
  reflow without horizontal scroll or overlapping the offset stacked
  panels.
- Toggle light/dark from the top nav while on the landing page: hero band
  stays the same fixed dark navy in both states (by design); the
  how-it-works/events/clubs sections below it follow the toggle via their
  token classes.
- Confirm existing `AllCitiesContent` behavior (city buttons, "Other
  locations" list) is pixel-identical to before when reached without a
  `q` param.
