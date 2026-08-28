# City Club Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the player-facing home page into a real City → Club → Location → Court drilldown, replacing today's flat list of every location with no geographic grouping and no clickable club (org) page.

**Architecture:** A new nullable `city` column on `locations`, populated through the existing address-lookup flow (Nominatim already computes a city value internally and discards it). Two new pure grouping functions back three page-level changes: a rewritten home page (city list + a fallback for not-yet-geocoded locations), a new city page (its clubs), and a new club page (all of that club's locations, unfiltered by city).

**Tech Stack:** Next.js App Router (server components), Supabase (Postgres), Vitest for pure-logic tests.

**Spec:** [docs/superpowers/specs/2026-08-28-city-club-drilldown-design.md](../specs/2026-08-28-city-club-drilldown-design.md)

## Global Constraints

- No new `cities` table and no slugs — the `/cities/[city]` route segment is the raw city name, URL-encoded/decoded directly against `locations.city`.
- A Club page always shows **all** of that club's locations, everywhere — never filtered to the city the player arrived from.
- A location with `city IS NULL` (not yet re-verified) must still appear somewhere on `/` — under an "Other locations" section — never silently disappear.
- The `organizations` table and all internal code/variable names stay `organization`/`org` — no rename. Only the new routes and player-facing copy say "Club."
- No personalization: no default-city-at-signup, no switcher, no stored preference. Out of scope for this plan.
- Every task ends with a commit.

---

### Task 1: Migration — `city` column on `locations`

**Files:**
- Create: `supabase/migrations/0013_location_city.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `locations.city` (nullable `text`) — Tasks 3, 5, 6, 7 read/write it.

- [ ] **Step 1: Write the migration file**

```sql
-- Nullable, no backfill -- same pattern as slot_size_minutes and the
-- geocoding columns (0008_location_geocoding.sql). Existing locations show
-- under the home page's "Other locations" fallback until an admin re-saves
-- their address through the lookup flow, which now also captures city.
alter table locations add column city text;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0013_location_city.sql`
Expected: `Applied supabase/migrations/0013_location_city.sql`

- [ ] **Step 3: Verify the column exists**

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(\"select column_name, is_nullable, data_type from information_schema.columns where table_name = 'locations' and column_name = 'city'\");
  console.log(res.rows);
  await client.end();
});
"
```

Expected: one row, `is_nullable: 'YES'`, `data_type: 'text'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_location_city.sql
git commit -m "Add nullable city column to locations"
```

---

### Task 2: `extractCity` pure function + geocode route returns `city`

**Files:**
- Modify: `src/app/api/geocode/route.ts`
- Test: `src/app/api/geocode/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function extractCity(address: NominatimAddress | undefined): string | null`, `GeocodeResult.city: string | null` — Task 3's `AddressLookup` consumes `GeocodeResult.city`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractCity } from "@/app/api/geocode/route";

describe("extractCity", () => {
  it("returns null for an undefined address", () => {
    expect(extractCity(undefined)).toBeNull();
  });

  it("prefers city over town, village, hamlet", () => {
    expect(
      extractCity({ city: "Los Angeles", town: "Ignored", village: "Ignored", hamlet: "Ignored" })
    ).toBe("Los Angeles");
  });

  it("falls back to town when city is missing", () => {
    expect(extractCity({ town: "Chewsday" })).toBe("Chewsday");
  });

  it("falls back to village when city and town are missing", () => {
    expect(extractCity({ village: "Smallville" })).toBe("Smallville");
  });

  it("falls back to hamlet when city, town, and village are missing", () => {
    expect(extractCity({ hamlet: "Tiny Hamlet" })).toBe("Tiny Hamlet");
  });

  it("returns null when nothing in the fallback chain is present", () => {
    expect(extractCity({ state: "California" })).toBeNull();
  });
});
```

Save this as `src/app/api/geocode/route.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- geocode`
Expected: FAIL — `extractCity is not a function` (or a resolution error, since `route.ts` doesn't export it yet).

- [ ] **Step 3: Extract `extractCity` and add `city` to `GeocodeResult`**

In `src/app/api/geocode/route.ts`, replace:

```ts
export type GeocodeResult = {
  label: string;
  simpleAddress: string;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  timezone: string | null;
};

function buildSimpleAddress(address: NominatimAddress | undefined, fallback: string): string {
  if (!address) return fallback;
  const city = address.city ?? address.town ?? address.village ?? address.hamlet;
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const parts = [street, city, address.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : fallback;
}
```

with:

```ts
export type GeocodeResult = {
  label: string;
  simpleAddress: string;
  postalCode: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  timezone: string | null;
};

export function extractCity(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  return address.city ?? address.town ?? address.village ?? address.hamlet ?? null;
}

function buildSimpleAddress(address: NominatimAddress | undefined, fallback: string): string {
  if (!address) return fallback;
  const city = extractCity(address);
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const parts = [street, city, address.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : fallback;
}
```

- [ ] **Step 4: Return `city` in the mapped results**

In the same file, inside `GET`, replace:

```ts
    return {
      label: r.display_name,
      simpleAddress: buildSimpleAddress(r.address, r.display_name),
      postalCode: r.address?.postcode ?? null,
      latitude,
      longitude,
      formattedAddress: r.display_name,
      timezone,
    };
```

with:

```ts
    return {
      label: r.display_name,
      simpleAddress: buildSimpleAddress(r.address, r.display_name),
      postalCode: r.address?.postcode ?? null,
      city: extractCity(r.address),
      latitude,
      longitude,
      formattedAddress: r.display_name,
      timezone,
    };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- geocode`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all existing tests still pass (41 total: 35 baseline + 6 new), no type errors. (`tsc --noEmit` may need `npx next typegen` run once first if this is a fresh checkout with no `.next/types` yet — see Task 8's note if it fails on `LayoutProps`.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/geocode/route.ts src/app/api/geocode/route.test.ts
git commit -m "Extract extractCity from the geocode route, return city in results"
```

---

### Task 3: Thread `city` through the address-lookup UI and location actions

**Files:**
- Modify: `src/components/AddressLookup.tsx`
- Modify: `src/components/LocationFormFields.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/page.tsx`
- Modify: `src/app/admin/actions.ts`

**Interfaces:**
- Consumes: `GeocodeResult.city` (Task 2); `locations.city` (Task 1).
- Produces: `createLocation`/`updateLocation` now save `city`; later tasks (5, 6, 7) read `locations.city` back out.

This is a mechanical, behavior-preserving-except-for-the-new-field wiring task — no new tests (matches this codebase's convention that Supabase-querying pages and simple prop-threading aren't unit tested).

- [ ] **Step 1: `src/components/AddressLookup.tsx`**

Replace:

```tsx
type Geocode = {
  postalCode: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

export default function AddressLookup({
  defaultAddress,
  defaultPostalCode,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  onLocationPicked,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  onLocationPicked?: (timezone: string) => void;
}) {
  const [address, setAddress] = useState(defaultAddress);
  const [geocode, setGeocode] = useState<Geocode | null>(
    defaultLatitude != null && defaultLongitude != null
      ? {
          postalCode: defaultPostalCode,
          latitude: defaultLatitude,
          longitude: defaultLongitude,
          formattedAddress: defaultFormattedAddress ?? defaultAddress,
        }
      : null
  );
```

with:

```tsx
type Geocode = {
  postalCode: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

export default function AddressLookup({
  defaultAddress,
  defaultPostalCode,
  defaultCity,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  onLocationPicked,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultCity: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  onLocationPicked?: (timezone: string) => void;
}) {
  const [address, setAddress] = useState(defaultAddress);
  const [geocode, setGeocode] = useState<Geocode | null>(
    defaultLatitude != null && defaultLongitude != null
      ? {
          postalCode: defaultPostalCode,
          city: defaultCity,
          latitude: defaultLatitude,
          longitude: defaultLongitude,
          formattedAddress: defaultFormattedAddress ?? defaultAddress,
        }
      : null
  );
```

Then replace:

```tsx
  function pick(result: GeocodeResult) {
    setAddress(result.simpleAddress);
    setGeocode({
      postalCode: result.postalCode,
      latitude: result.latitude,
      longitude: result.longitude,
      formattedAddress: result.formattedAddress,
    });
    setResults([]);
    if (result.timezone) onLocationPicked?.(result.timezone);
  }
```

with:

```tsx
  function pick(result: GeocodeResult) {
    setAddress(result.simpleAddress);
    setGeocode({
      postalCode: result.postalCode,
      city: result.city,
      latitude: result.latitude,
      longitude: result.longitude,
      formattedAddress: result.formattedAddress,
    });
    setResults([]);
    if (result.timezone) onLocationPicked?.(result.timezone);
  }
```

Then replace:

```tsx
      <input type="hidden" name="postal_code" value={geocode?.postalCode ?? ""} />
      <input type="hidden" name="latitude" value={geocode?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={geocode?.longitude ?? ""} />
      <input type="hidden" name="formatted_address" value={geocode?.formattedAddress ?? ""} />
```

with:

```tsx
      <input type="hidden" name="postal_code" value={geocode?.postalCode ?? ""} />
      <input type="hidden" name="city" value={geocode?.city ?? ""} />
      <input type="hidden" name="latitude" value={geocode?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={geocode?.longitude ?? ""} />
      <input type="hidden" name="formatted_address" value={geocode?.formattedAddress ?? ""} />
```

- [ ] **Step 2: `src/components/LocationFormFields.tsx`**

Replace:

```tsx
export default function LocationFormFields({
  defaultAddress,
  defaultPostalCode,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  defaultTimezone,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  defaultTimezone: string;
}) {
  const [timezone, setTimezone] = useState(defaultTimezone);

  return (
    <>
      <AddressLookup
        defaultAddress={defaultAddress}
        defaultPostalCode={defaultPostalCode}
        defaultLatitude={defaultLatitude}
        defaultLongitude={defaultLongitude}
        defaultFormattedAddress={defaultFormattedAddress}
        onLocationPicked={setTimezone}
      />
```

with:

```tsx
export default function LocationFormFields({
  defaultAddress,
  defaultPostalCode,
  defaultCity,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  defaultTimezone,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultCity: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  defaultTimezone: string;
}) {
  const [timezone, setTimezone] = useState(defaultTimezone);

  return (
    <>
      <AddressLookup
        defaultAddress={defaultAddress}
        defaultPostalCode={defaultPostalCode}
        defaultCity={defaultCity}
        defaultLatitude={defaultLatitude}
        defaultLongitude={defaultLongitude}
        defaultFormattedAddress={defaultFormattedAddress}
        onLocationPicked={setTimezone}
      />
```

- [ ] **Step 3: `src/app/admin/page.tsx`**

Replace:

```tsx
        <LocationFormFields
          defaultAddress=""
          defaultPostalCode={null}
          defaultLatitude={null}
          defaultLongitude={null}
          defaultFormattedAddress={null}
          defaultTimezone="America/Los_Angeles"
        />
```

with:

```tsx
        <LocationFormFields
          defaultAddress=""
          defaultPostalCode={null}
          defaultCity={null}
          defaultLatitude={null}
          defaultLongitude={null}
          defaultFormattedAddress={null}
          defaultTimezone="America/Los_Angeles"
        />
```

- [ ] **Step 4: `src/app/admin/locations/[locationId]/page.tsx`**

Replace:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, timezone, postal_code, latitude, longitude, formatted_address, org_id")
    .eq("id", locationId)
    .single();
```

with:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, timezone, postal_code, city, latitude, longitude, formatted_address, org_id")
    .eq("id", locationId)
    .single();
```

Then replace:

```tsx
          <LocationFormFields
            defaultAddress={location.address ?? ""}
            defaultPostalCode={location.postal_code ?? null}
            defaultLatitude={location.latitude ?? null}
            defaultLongitude={location.longitude ?? null}
            defaultFormattedAddress={location.formatted_address ?? null}
            defaultTimezone={location.timezone}
          />
```

with:

```tsx
          <LocationFormFields
            defaultAddress={location.address ?? ""}
            defaultPostalCode={location.postal_code ?? null}
            defaultCity={location.city ?? null}
            defaultLatitude={location.latitude ?? null}
            defaultLongitude={location.longitude ?? null}
            defaultFormattedAddress={location.formatted_address ?? null}
            defaultTimezone={location.timezone}
          />
```

- [ ] **Step 5: `src/app/admin/actions.ts`**

Replace:

```ts
function geocodeFieldsFromFormData(formData: FormData) {
  const postalCode = String(formData.get("postal_code") || "") || null;
  const latitude = formData.get("latitude");
  const longitude = formData.get("longitude");
  const formattedAddress = String(formData.get("formatted_address") || "") || null;

  return {
    postal_code: postalCode,
    latitude: latitude ? Number(latitude) || null : null,
    longitude: longitude ? Number(longitude) || null : null,
    formatted_address: formattedAddress,
  };
}
```

with:

```ts
function geocodeFieldsFromFormData(formData: FormData) {
  const postalCode = String(formData.get("postal_code") || "") || null;
  const city = String(formData.get("city") || "") || null;
  const latitude = formData.get("latitude");
  const longitude = formData.get("longitude");
  const formattedAddress = String(formData.get("formatted_address") || "") || null;

  return {
    postal_code: postalCode,
    city,
    latitude: latitude ? Number(latitude) || null : null,
    longitude: longitude ? Number(longitude) || null : null,
    formatted_address: formattedAddress,
  };
}
```

`createLocation` and `updateLocation` both already spread `...geocodeFieldsFromFormData(formData)` into their insert/update calls — no further change needed in either function.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manually verify in the browser**

With the dev server running: go to `/admin`, add a location with a real address via "Look up address," save it, then re-open its "Edit location" disclosure — confirm the address lookup still shows "Address verified" (i.e. nothing broke in the existing flow). Then confirm the new value landed in the database:

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(\"select id, name, city from locations order by id desc limit 1\");
  console.log(res.rows);
  await client.end();
});
"
```

Expected: the just-created location's row has a non-null `city`.

- [ ] **Step 8: Commit**

```bash
git add src/components/AddressLookup.tsx src/components/LocationFormFields.tsx src/app/admin/page.tsx "src/app/admin/locations/[locationId]/page.tsx" src/app/admin/actions.ts
git commit -m "Thread city through the address lookup UI and location create/update actions"
```

---

### Task 4: Pure grouping logic (`src/lib/cityGrouping.ts`), built test-first

**Files:**
- Create: `src/lib/cityGrouping.ts`
- Test: `src/lib/cityGrouping.test.ts`

**Interfaces:**
- Consumes: nothing (pure, generic over caller-supplied shapes).
- Produces: `export interface CityGroup { city: string; clubCount: number }`, `export interface GroupedByCity<T> { cities: CityGroup[]; otherLocations: T[] }`, `export function groupLocationsByCity<T extends { city: string | null; orgId: string }>(locations: T[]): GroupedByCity<T>`, `export interface ClubInCity { orgId: string; orgName: string; locationCount: number }`, `export function clubsInCity<T extends { city: string | null; orgId: string; orgName: string }>(locations: T[], city: string): ClubInCity[]` — Tasks 5 and 6 import these exact names from `@/lib/cityGrouping`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { groupLocationsByCity, clubsInCity } from "@/lib/cityGrouping";

describe("groupLocationsByCity", () => {
  it("returns empty groups for no locations", () => {
    expect(groupLocationsByCity([])).toEqual({ cities: [], otherLocations: [] });
  });

  it("counts distinct clubs per city", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a" },
      { id: "2", city: "New York", orgId: "org-a" }, // same club, same city -- counted once
      { id: "3", city: "New York", orgId: "org-b" },
      { id: "4", city: "Los Angeles", orgId: "org-a" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities).toEqual([
      { city: "Los Angeles", clubCount: 1 },
      { city: "New York", clubCount: 2 },
    ]);
    expect(result.otherLocations).toEqual([]);
  });

  it("sorts cities alphabetically", () => {
    const locations = [
      { id: "1", city: "Zion", orgId: "org-a" },
      { id: "2", city: "Amityville", orgId: "org-b" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities.map((c) => c.city)).toEqual(["Amityville", "Zion"]);
  });

  it("routes locations with no city to otherLocations, excluded from cities", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a" },
      { id: "2", city: null, orgId: "org-b" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities).toEqual([{ city: "New York", clubCount: 1 }]);
    expect(result.otherLocations).toEqual([{ id: "2", city: null, orgId: "org-b" }]);
  });
});

describe("clubsInCity", () => {
  it("returns only clubs with a location in the given city", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
      { id: "2", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
      { id: "3", city: "New York", orgId: "org-b", orgName: "Beta Club" },
      { id: "4", city: "Los Angeles", orgId: "org-c", orgName: "Gamma Club" },
    ];
    expect(clubsInCity(locations, "New York")).toEqual([
      { orgId: "org-a", orgName: "Ace Volleyball Club", locationCount: 2 },
      { orgId: "org-b", orgName: "Beta Club", locationCount: 1 },
    ]);
  });

  it("sorts clubs alphabetically by name", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-z", orgName: "Zebra Courts" },
      { id: "2", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
    ];
    expect(clubsInCity(locations, "New York").map((c) => c.orgName)).toEqual([
      "Ace Volleyball Club",
      "Zebra Courts",
    ]);
  });

  it("returns an empty list for a city with no matching locations", () => {
    const locations = [{ id: "1", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" }];
    expect(clubsInCity(locations, "Nowhere")).toEqual([]);
  });

  it("excludes locations with no city", () => {
    const locations = [{ id: "1", city: null, orgId: "org-a", orgName: "Ace Volleyball Club" }];
    expect(clubsInCity(locations, "New York")).toEqual([]);
  });
});
```

Save this as `src/lib/cityGrouping.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- cityGrouping`
Expected: FAIL — `Failed to resolve import "@/lib/cityGrouping"`.

- [ ] **Step 3: Write the implementation**

```ts
export interface CityGroup {
  city: string;
  clubCount: number;
}

export interface GroupedByCity<T> {
  cities: CityGroup[];
  otherLocations: T[];
}

// For the home page: groups locations into per-city club counts, plus a
// fallback bucket for locations with no city set yet.
export function groupLocationsByCity<T extends { city: string | null; orgId: string }>(
  locations: T[]
): GroupedByCity<T> {
  const otherLocations: T[] = [];
  const clubsByCity = new Map<string, Set<string>>();

  for (const location of locations) {
    if (!location.city) {
      otherLocations.push(location);
      continue;
    }
    const clubs = clubsByCity.get(location.city) ?? new Set<string>();
    clubs.add(location.orgId);
    clubsByCity.set(location.city, clubs);
  }

  const cities: CityGroup[] = Array.from(clubsByCity.entries())
    .map(([city, clubs]) => ({ city, clubCount: clubs.size }))
    .sort((a, b) => a.city.localeCompare(b.city));

  return { cities, otherLocations };
}

export interface ClubInCity {
  orgId: string;
  orgName: string;
  locationCount: number;
}

// For a city page: the distinct clubs with at least one location in the
// given city, sorted alphabetically by name.
export function clubsInCity<T extends { city: string | null; orgId: string; orgName: string }>(
  locations: T[],
  city: string
): ClubInCity[] {
  const countByClub = new Map<string, ClubInCity>();

  for (const location of locations) {
    if (location.city !== city) continue;
    const existing = countByClub.get(location.orgId);
    if (existing) {
      existing.locationCount += 1;
    } else {
      countByClub.set(location.orgId, {
        orgId: location.orgId,
        orgName: location.orgName,
        locationCount: 1,
      });
    }
  }

  return Array.from(countByClub.values()).sort((a, b) => a.orgName.localeCompare(b.orgName));
}
```

Save this as `src/lib/cityGrouping.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- cityGrouping`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (50 total: 41 from Task 2 + 9 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cityGrouping.ts src/lib/cityGrouping.test.ts
git commit -m "Add pure city/club grouping logic (groupLocationsByCity, clubsInCity)"
```

---

### Task 5: Rewrite `/` (home page) into the City list

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `groupLocationsByCity` from `@/lib/cityGrouping` (Task 4); `locations.city` (Task 1).
- Produces: nothing new for later tasks — the city cards it renders link to `/cities/[city]` (Task 6), the "Other locations" cards link to `/clubs/[orgId]` (Task 7). Both routes don't exist until those tasks land, so this task's links will 404 until then — that's expected and fine (each task is reviewed independently; Task 8 does the end-to-end walkthrough once everything is in place).

- [ ] **Step 1: Replace the file**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";
import { groupLocationsByCity } from "@/lib/cityGrouping";

export default async function Home() {
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: locations } = await supabase
    .from("locations")
    .select(
      "id, name, address, city, latitude, longitude, organization:organizations(id, name), courts!inner(id, is_active)"
    )
    .eq("courts.is_active", true);

  // Dedupe locations (the courts!inner join returns one row per matching court)
  // and flatten the organization relation into orgId/orgName for the grouping
  // helper, which is generic over any shape carrying those two fields.
  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .map((l) => {
      const org = Array.isArray(l.organization) ? l.organization[0] : l.organization;
      return {
        id: l.id,
        name: l.name,
        address: l.address,
        city: l.city,
        latitude: l.latitude,
        longitude: l.longitude,
        orgId: org?.id ?? "",
        orgName: org?.name ?? "",
      };
    });

  const { cities, otherLocations } = groupLocationsByCity(uniqueLocations);
  const sortedOtherLocations = [...otherLocations].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

      {cities.length === 0 && sortedOtherLocations.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No locations available yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {cities.map((cityGroup) => (
          <li key={cityGroup.city}>
            <Link
              href={`/cities/${encodeURIComponent(cityGroup.city)}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{cityGroup.city}</p>
              <p className="text-sm text-gray-600">
                {cityGroup.clubCount} club{cityGroup.clubCount === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {sortedOtherLocations.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium">Other locations</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {sortedOtherLocations.map((location) => {
              const mapsUrl = buildMapsUrl({
                latitude: location.latitude ?? null,
                longitude: location.longitude ?? null,
                address: location.address ?? null,
                userAgent,
              });
              return (
                <li
                  key={location.id}
                  className="rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <Link href={`/locations/${location.id}`} className="block font-medium">
                    {location.name}
                  </Link>
                  <Link
                    href={`/clubs/${location.orgId}`}
                    className="text-sm text-gray-600 underline decoration-dotted"
                  >
                    {location.orgName}
                  </Link>
                  {location.address && (
                    <a
                      href={mapsUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-sm text-gray-600 underline decoration-dotted"
                    >
                      {location.address}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
```

Note this deliberately does NOT nest the org-name `<Link>` inside the location-name `<Link>` (that would render nested `<a>` tags, which is invalid HTML and breaks click behavior) — they're siblings, matching how the address link is already a sibling of the name link in the original version of this file.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify in the browser**

Visit `/`. If any seeded locations already have a `city` value (from Task 3's manual verification, or any you set directly via SQL for testing), confirm they're grouped into city cards with the right club counts instead of appearing as flat individual entries. Confirm any location with no `city` still appears under "Other locations." Clicking a city card or a "Other locations" org-name link will 404 for now (routes land in Tasks 6 and 7) — that's expected, not a bug in this task.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Rewrite home page into a city list with an other-locations fallback"
```

---

### Task 6: New `/cities/[city]` page

**Files:**
- Create: `src/app/cities/[city]/page.tsx`

**Interfaces:**
- Consumes: `clubsInCity` from `@/lib/cityGrouping` (Task 4); `locations.city` (Task 1).
- Produces: nothing new for later tasks — its club cards link to `/clubs/[orgId]` (Task 7), not live until that task lands.

- [ ] **Step 1: Create the page**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clubsInCity } from "@/lib/cityGrouping";

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: cityParam } = await params;
  const city = decodeURIComponent(cityParam);
  const supabase = await createClient();

  const { data: locations } = await supabase
    .from("locations")
    .select("id, city, organization:organizations(id, name), courts!inner(id, is_active)")
    .eq("city", city)
    .eq("courts.is_active", true);

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

  const clubs = clubsInCity(uniqueLocations, city);

  if (clubs.length === 0) {
    notFound();
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{city}</h1>

      <ul className="mt-6 flex flex-col gap-3">
        {clubs.map((club) => (
          <li key={club.orgId}>
            <Link
              href={`/clubs/${club.orgId}`}
              className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <p className="font-medium">{club.orgName}</p>
              <p className="text-sm text-gray-600">
                {club.locationCount} location{club.locationCount === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Save this as `src/app/cities/[city]/page.tsx`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify in the browser**

Visit `/cities/<a-real-city-value>` directly (URL-encoded if it has a space, e.g. `/cities/New%20York`) for a city you know has a location with an active court. Confirm the right club(s) appear with correct location counts. Visit `/cities/Nowhere` (a city with no matches) and confirm it 404s. Club links will 404 for now (Task 7 not landed yet).

- [ ] **Step 4: Commit**

```bash
git add "src/app/cities/[city]/page.tsx"
git commit -m "Add /cities/[city] page listing that city's clubs"
```

---

### Task 7: New `/clubs/[orgId]` page + fix the location page's back-link

**Files:**
- Create: `src/app/clubs/[orgId]/page.tsx`
- Modify: `src/app/locations/[locationId]/page.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks (queries `organizations`/`locations` directly).
- Produces: nothing new for later tasks — this closes the loop (City → Club → Location, all routes now live).

- [ ] **Step 1: Create the Club page**

```tsx
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";

export default async function ClubPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();

  if (!org) {
    notFound();
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, latitude, longitude, courts!inner(id, is_active)")
    .eq("org_id", orgId)
    .eq("courts.is_active", true);

  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (uniqueLocations.length === 0) {
    notFound();
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{org.name}</h1>

      <ul className="mt-6 flex flex-col gap-3">
        {uniqueLocations.map((location) => {
          const mapsUrl = buildMapsUrl({
            latitude: location.latitude ?? null,
            longitude: location.longitude ?? null,
            address: location.address ?? null,
            userAgent,
          });
          return (
            <li
              key={location.id}
              className="rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              <Link href={`/locations/${location.id}`} className="block">
                <p className="font-medium">{location.name}</p>
              </Link>
              {location.address && (
                <a
                  href={mapsUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-sm text-gray-600 underline decoration-dotted"
                >
                  {location.address}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

Save this as `src/app/clubs/[orgId]/page.tsx`.

- [ ] **Step 2: Fix the location page's back-link**

In `src/app/locations/[locationId]/page.tsx`, replace:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, latitude, longitude, organization:organizations(name)")
    .eq("id", locationId)
    .single();
```

with:

```tsx
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, latitude, longitude, organization:organizations(id, name)")
    .eq("id", locationId)
    .single();
```

Then replace:

```tsx
      <Link href="/" className="text-sm underline">
        &larr; All locations
      </Link>
```

with:

```tsx
      <Link href={`/clubs/${org?.id ?? ""}`} className="text-sm underline">
        &larr; {org?.name ?? "Club"}
      </Link>
```

(`org` is already computed above this point in the file from `location.organization`, via the existing `Array.isArray(...)` unwrap — no new variable needed. Note this replace must land AFTER that `org` computation and the `notFound()` check, same position the original `<Link href="/">` occupied.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify in the browser**

Visit `/clubs/<a-real-org-id>` directly and confirm all of that org's active-court locations appear (regardless of which city each is in, if you've set different cities on different locations). Click through to a location and confirm the back-link now reads "← <Club name>" and returns to the Club page instead of "← All locations" / `/`. Confirm the court-booking flow on that location page is otherwise completely unaffected.

- [ ] **Step 5: Commit**

```bash
git add "src/app/clubs/[orgId]/page.tsx" "src/app/locations/[locationId]/page.tsx"
git commit -m "Add /clubs/[orgId] page, point the location page's back-link at it"
```

---

### Task 8: End-to-end verification + status log update

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation + verification only).

- [ ] **Step 1: Full walkthrough in the browser**

With all prior tasks landed:
1. Re-save at least one location per each of the three seeded cities (New York, Los Angeles, London) through the admin address lookup, so `city` is populated for a good end-to-end test (skip any already set from earlier manual testing).
2. Visit `/` — confirm three (or however many populated) city cards appear with correct club counts, sorted alphabetically.
3. Click into each city — confirm the right club(s) appear with correct location counts.
4. Click into "Ace Volleyball Club" (or whichever club has locations spanning more than one city in your test data) from one city, and confirm its page shows ALL of its locations, not just the ones in the city you came from.
5. Click into a location, confirm the booking flow is unaffected, and confirm the back-link reads the club's name and returns to the Club page.
6. Temporarily null out one location's `city` directly in the database, confirm it now appears under `/`'s "Other locations" section instead of contributing to a city card, then restore it:

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Substitute a real location id from your test data.
  await client.query(\"update locations set city = null where id = 'LOCATION_ID_HERE'\");
  console.log('cleared for test');
  await client.end();
});
"
```

Then re-run the same query with the original city value to restore it.

- [ ] **Step 2: Run the full verification suite**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (50 total), no type errors.

- [ ] **Step 3: Update the status log**

In `CLAUDE.md`, find the existing unchecked bullet:

```
- [ ] City-scoped home page with a default city set at signup -- ...
```

Immediately after it, add a new checked entry:

```markdown
- [x] Superseded above (partially): City > Club > Location > Court drilldown shipped -- the player-facing home page (`/`) now shows a city list instead of a flat list of every location, drilling into `/cities/[city]` (that city's clubs) then `/clubs/[orgId]` (Task 7 -- new player-facing page, since none existed before; always shows *all* of a club's locations, not filtered to the city you arrived from, since one club can span several cities -- e.g. the seeded "Ace Volleyball Club" has locations in New York, Los Angeles, and London) then the existing `/locations/[locationId]`. New nullable `locations.city` column (`supabase/migrations/0013_location_city.sql`, no backfill -- same pattern as the geocoding columns), populated through the existing address-lookup flow: Nominatim already computed a city value internally and discarded it (only folding it into the free-text `simpleAddress`); `extractCity` in `src/app/api/geocode/route.ts` pulls that into its own tested function and a new `GeocodeResult.city` field. Two new pure grouping functions, `groupLocationsByCity`/`clubsInCity` (`src/lib/cityGrouping.ts`, built test-first), back the city list and city-page club list. A location with no `city` yet (not re-verified through the lookup flow) doesn't disappear -- it shows under a new "Other locations" section on `/`. Only the *navigational hierarchy* half of the original backlog item shipped -- the personalization half (default city set at signup, a session-override switcher) is still deferred, unasked for in this pass.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Update status log: city/club drilldown shipped"
```
