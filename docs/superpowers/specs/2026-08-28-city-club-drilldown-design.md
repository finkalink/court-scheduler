# City > Club > Location > Court Drilldown — Design Spec

Status: approved for implementation
Date: 2026-08-28

## Goal

Restructure the player-facing home page from a flat list of every location
into a real drilldown: City → Club → Location → Court. Today `/` lists
every active-court location across every org with no geographic grouping,
and there's no player-facing "club" (org) page at all — an org's name is
just non-clickable subtitle text.

This is the second sub-project of a two-part backlog item split during
brainstorming for "club admins." The first part — letting an org
owner/admin grant admin access by email, with a real `staff` capability
split — already shipped (see the "club admins shipped" entry in
`CLAUDE.md`'s status log).

## Non-goals (explicitly out of scope)

- **Personalization.** No default-city-at-signup, no session-override
  switcher, no stored player preference. This spec is purely the
  navigational restructure; the original backlog item's personalization
  half is deferred again, separately, until asked for.
- **Admin-side changes.** `/admin` already scopes to the org(s) you
  administer and doesn't need city grouping. Untouched.
- **New org-level content.** No description, logo, or other new
  `organizations` fields — the Club page is name + its locations, nothing
  more.
- **A `cities` table or city slugs.** City stays a derived, grouped value
  read off `locations.city` — no new table, no slug↔name mapping. This app
  has no slug precedent anywhere (every other route uses a UUID); the city
  route segment is the raw city name, URL-encoded.

## Terminology

The `organizations` table and all internal code/variable names stay as
`organization`/`org` — no rename. Only the new route and player-facing
copy say "Club," matching how this project's own conversations and
`CLAUDE.md` already refer to orgs colloquially.

## Data model

New migration: `supabase/migrations/0013_location_city.sql`

```sql
-- Nullable, no backfill -- same pattern as slot_size_minutes and the
-- geocoding columns (0008_location_geocoding.sql). Existing locations show
-- under the home page's "Other locations" fallback until an admin re-saves
-- their address through the lookup flow, which now also captures city.
alter table locations add column city text;
```

No RLS change needed — `city` is just another column under the existing
`locations select all` (`using (true)`) policy.

## `/api/geocode` change

`src/app/api/geocode/route.ts`'s `GeocodeResult` type gets a new field:

```ts
export type GeocodeResult = {
  // ...existing fields...
  city: string | null;
};
```

The route already computes a city value internally (`address.city ??
address.town ?? address.village ?? address.hamlet`) inside
`buildSimpleAddress`, then discards it — only folding it into the free-text
`simpleAddress` string. Extract that fallback chain into its own pure,
exported function so it can be returned as a real field:

```ts
export function extractCity(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  return address.city ?? address.town ?? address.village ?? address.hamlet ?? null;
}
```

`buildSimpleAddress` calls `extractCity` internally instead of repeating
the chain (behavior unchanged). Built test-first — real branching (4-way
fallback, undefined address), same convention as `resolveDayHours`/
`filterHoursToWindow`.

`AddressLookup.tsx` / `LocationFormFields.tsx` thread the new `city` value
through as a hidden field, same pattern as `postal_code`/`latitude`/
`longitude`/`formatted_address` today. `createLocation` and `updateLocation`
(`src/app/admin/actions.ts`) read and save it alongside the existing
geocode fields.

## Pure grouping logic (`src/lib/cityGrouping.ts`, built test-first)

Two small, purpose-named functions (kept separate rather than unified
behind one generic "group and count" helper — different filters, different
keys, and three similar lines beats a premature abstraction here, matching
this project's existing convention).

```ts
export interface CityGroup {
  city: string;
  clubCount: number; // distinct orgs with a location in this city
}

export interface GroupedByCity<T> {
  cities: CityGroup[]; // sorted alphabetically by city
  otherLocations: T[]; // locations with city === null
}

// For the home page: groups locations into per-city club counts, plus a
// fallback bucket for locations with no city set yet.
export function groupLocationsByCity<T extends { city: string | null; orgId: string }>(
  locations: T[]
): GroupedByCity<T>;

export interface ClubInCity {
  orgId: string;
  orgName: string;
  locationCount: number; // this club's locations in this specific city
}

// For a city page: the distinct clubs with at least one location in the
// given city, sorted alphabetically by name.
export function clubsInCity<T extends { city: string | null; orgId: string; orgName: string }>(
  locations: T[],
  city: string
): ClubInCity[];
```

Test cases: empty input; a single city with one club; a city with two
locations from the same club (counted once as a club, `locationCount: 2`
in `clubsInCity`); multiple cities sorted correctly; locations with
`city: null` routed to `otherLocations` and excluded from `cities`;
`clubsInCity` filtering to only the requested city.

## Routes

**`/` (`src/app/page.tsx`, rewritten)** — the City list.
- Query: same shape as today's (`locations` with an `!inner` join on active
  `courts`, deduped by location id), now also selecting `city` and the
  organization's `id` (needed for `orgId` in the grouping functions and for
  linking "Other locations" cards to their club).
- Pass the deduped list through `groupLocationsByCity`.
- Render each `CityGroup` as a card: city name + "N clubs", linking to
  `/cities/[city]` (`encodeURIComponent(city)`).
- Below that, an "Other locations" section (only rendered if non-empty)
  showing `otherLocations` with today's exact card style (name, org name as
  a link to `/clubs/[orgId]`, address/maps link) — nothing already-visible
  disappears just because it lacks a city yet. Sorted by location name
  (the current page has no explicit sort at all; this is a small, low-risk
  improvement worth making while touching this query, not a new decision
  point).

**`/cities/[city]` (new, `src/app/cities/[city]/page.tsx`)**
- Decode the `city` param, query locations matching it (same active-court
  join), run `clubsInCity`.
- `notFound()` if the result is empty (no active-court location matches
  that city — e.g. a stale/mistyped URL).
- Render each `ClubInCity` as a card: club name + "N location(s)", linking
  to `/clubs/[orgId]`.
- A "← All cities" link back to `/`.

**`/clubs/[orgId]` (new, `src/app/clubs/[orgId]/page.tsx`)**
- Query the organization by id (`notFound()` if missing), then its
  locations with an active court (no city filter — a club page always
  shows everywhere it operates, per the earlier decision).
- Render with today's home-page card style (name, address/maps link),
  each linking to the existing `/locations/[locationId]`.
- A "← All cities" link back to `/` (a specific city isn't part of this
  page's own state, since a club can span several).

**`/locations/[locationId]` (existing, one change)**
- Its query already selects `organization:organizations(name)`; add `id`
  to that select.
- `<Link href="/">&larr; All locations</Link>` becomes
  `<Link href={`/clubs/${org.id}`}>&larr; {org.name}</Link>`.

**`/locations/[locationId]/courts/[courtId]`** — unchanged. It already
links back to its parent location page, which now correctly leads back up
through Club instead of straight to the old flat list.

## Testing plan

- `extractCity` and `buildSimpleAddress`'s continued correct behavior —
  test-first, in `src/app/api/geocode/route.test.ts` (first test file for
  this route).
- `groupLocationsByCity` and `clubsInCity` — test-first, in
  `src/lib/cityGrouping.test.ts`.
- No new tests for the three page components themselves (server components
  with DB queries + JSX aren't unit-tested elsewhere in this codebase
  either) — verified manually in the browser instead.

## Manual verification plan

- Apply and verify the migration.
- Re-save an existing location's address through the admin address lookup,
  confirm `city` gets populated (check the DB directly, since there's no
  UI display of the raw city value yet).
- With at least one location per city among the three seeded cities (New
  York, Los Angeles, London) verified: confirm `/` shows three city cards
  with correct club counts, click through each to `/cities/[city]` and
  confirm the right club(s) appear, click through to `/clubs/[orgId]` and
  confirm all of that club's locations show regardless of city, click
  through to a location and confirm the existing court-booking flow is
  untouched. Confirm the Club page's back-link goes to `/` (not back to
  the specific city page you arrived from) — that's by design, since a
  club isn't scoped to any one city.
- Temporarily null out one location's `city` (matching the pattern already
  used to test the weather widget's missing-coordinates case), confirm it
  appears under "Other locations" on `/` instead of vanishing, then restore
  it.
- Confirm a location whose org has zero other active-court locations still
  renders a working (single-location) Club page.
