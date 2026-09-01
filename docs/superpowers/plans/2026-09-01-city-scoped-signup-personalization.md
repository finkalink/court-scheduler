# City-Scoped Signup Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player gets a default city (set at first login, editable later on `/profile`), the home page (`/`) shows that city's clubs/events directly instead of the full city list, and a cookie-based session override lets anyone browse a different city temporarily without touching the stored default.

**Architecture:** Two new nullable/defaulted columns on `users`. A pure precedence function (`resolveHomeCity`) decides, on every `/` request, whether to render a single city's content or the full directory. Two existing page bodies (today's `/` and today's `/cities/[city]`) get extracted into shared server components (`AllCitiesContent`, `CityContent`) so `/`, the new `/cities` route, and `/cities/[city]` each render one of them without duplicating any query logic. A small `cityPreference.ts` action file owns every write: the one-time first-login pick/skip, the `/profile` edit, and the session-cookie override.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), Supabase (Postgres + `@supabase/ssr`), `next/headers` `cookies()`, Vitest for the one pure-logic unit.

**Spec:** [docs/superpowers/specs/2026-09-01-city-scoped-signup-personalization-design.md](../specs/2026-09-01-city-scoped-signup-personalization-design.md)

## Global Constraints

- `default_city` is free text validated against the **live** set of cities with an active-court location — never a DB enum or FK, since that set changes as clubs open/close.
- The `city_override` cookie is a **browser session cookie** — no `maxAge`/`expires` — cleared when the browser closes. `httpOnly: true`, `sameSite: "lax"`, `path: "/"`.
- Cookie writes only happen inside Server Actions (`"use server"` functions), never during a page's render — Next.js forbids `cookies().set()`/`.delete()` outside an Action or Route Handler.
- Skipping the first-login city prompt is **permanent** (`city_prompt_dismissed = true`) — it must never reappear on a later login.
- No new RLS policies or trigger changes — `"users update own"` (`supabase/migrations/0002_rls.sql`) already covers both new columns, and neither is identity-sensitive (`supabase/migrations/0023_protect_users_identity_columns.sql`'s trigger only guards `email`/`role`).
- Follow this repo's TDD convention (`CLAUDE.md`): only pure logic gets a Vitest unit (matching the existing split — `src/lib/cityGrouping.ts` is tested, `src/lib/orgMembership.ts`, a thin Supabase query wrapper, is not). Page/Server-Action code is verified manually in the browser (Task 10), not with RTL, matching how every other page/action in this codebase is handled.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0027_city_personalization.sql`

**Interfaces:**
- Produces: `users.default_city` (`text`, nullable), `users.city_prompt_dismissed` (`boolean not null default false`) — every later task in this plan reads/writes these two columns by exactly these names.

- [ ] **Step 1: Write the migration**

```sql
-- City-scoped signup personalization
-- (docs/superpowers/specs/2026-09-01-city-scoped-signup-personalization-design.md).
--
-- default_city is free text, not an FK/enum -- it must match one of the
-- currently-active `locations.city` values, and that set changes as clubs
-- open and close, so it's validated in the app (isKnownCity,
-- src/lib/cityGrouping.ts) rather than as a DB check constraint. A stale
-- value (the city's last club later closes) is handled gracefully at read
-- time (resolveHomeCity falls through to the full list), not cleaned up
-- here -- same "no backfill" convention as slot_size_minutes, the
-- geocoding columns, etc.
--
-- city_prompt_dismissed tracks a permanent skip of the one-time "pick your
-- city" prompt shown at first login (src/app/choose-city/page.tsx) -- once
-- true, the prompt never reappears; the player can still set a city later
-- from /profile.
--
-- Neither column is identity-sensitive, so neither needs to be added to
-- the users_protect_identity_columns trigger (0023_protect_users_identity_columns.sql).
-- No RLS changes needed -- "users update own" (0002_rls.sql) already
-- covers both.

alter table users add column default_city text;
alter table users add column city_prompt_dismissed boolean not null default false;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Run: `npm run migrate -- supabase/migrations/0027_city_personalization.sql`
Expected: `Applied supabase/migrations/0027_city_personalization.sql`

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
node --env-file=.env.local -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query('select default_city, city_prompt_dismissed from users limit 1'))
  .then((r) => { console.log('OK', r.fields.map((f) => f.name)); return c.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
"
```
Expected: `OK [ 'default_city', 'city_prompt_dismissed' ]` with no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0027_city_personalization.sql
git commit -m "Add default_city and city_prompt_dismissed columns to users"
```

---

### Task 2: Pure city-resolution logic (TDD)

**Files:**
- Modify: `src/lib/cityGrouping.ts`
- Modify: `src/lib/cityGrouping.test.ts`

**Interfaces:**
- Produces: `resolveHomeCity({ overrideCity, defaultCity, availableCities }): string | null`, `isKnownCity(city: string, availableCities: string[]): boolean` — both exported from `src/lib/cityGrouping.ts`. Task 4 (actions), Task 7 (home page), and Task 9 (profile) import these by these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/cityGrouping.test.ts` (after the existing `clubsInCity` describe block):

```ts
import { resolveHomeCity, isKnownCity } from "@/lib/cityGrouping";

describe("resolveHomeCity", () => {
  const availableCities = ["Los Angeles", "New York"];

  it("prefers a valid override over a valid default", () => {
    expect(
      resolveHomeCity({ overrideCity: "Los Angeles", defaultCity: "New York", availableCities })
    ).toBe("Los Angeles");
  });

  it("falls back to the default when there's no override", () => {
    expect(resolveHomeCity({ overrideCity: null, defaultCity: "New York", availableCities })).toBe(
      "New York"
    );
  });

  it("falls back to the default when the override is stale", () => {
    expect(
      resolveHomeCity({ overrideCity: "Chicago", defaultCity: "New York", availableCities })
    ).toBe("New York");
  });

  it("returns null when neither override nor default is set", () => {
    expect(resolveHomeCity({ overrideCity: null, defaultCity: null, availableCities })).toBeNull();
  });

  it("returns null when the default is stale and there's no override", () => {
    expect(resolveHomeCity({ overrideCity: null, defaultCity: "Chicago", availableCities })).toBeNull();
  });

  it("returns null when both override and default are stale", () => {
    expect(
      resolveHomeCity({ overrideCity: "Chicago", defaultCity: "Boston", availableCities })
    ).toBeNull();
  });
});

describe("isKnownCity", () => {
  it("returns true for a city in the list", () => {
    expect(isKnownCity("New York", ["New York", "Los Angeles"])).toBe(true);
  });

  it("returns false for a city not in the list", () => {
    expect(isKnownCity("Chicago", ["New York", "Los Angeles"])).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isKnownCity("", ["New York"])).toBe(false);
  });
});
```

Note: move the new `import { resolveHomeCity, isKnownCity } from "@/lib/cityGrouping";` line up next to the existing `import { groupLocationsByCity, clubsInCity } from "@/lib/cityGrouping";` line at the top of the file instead of leaving two separate import statements from the same module.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- cityGrouping`
Expected: FAIL — `resolveHomeCity`/`isKnownCity` are not exported from `@/lib/cityGrouping`.

- [ ] **Step 3: Implement the functions**

Append to `src/lib/cityGrouping.ts`:

```ts
export interface ResolveHomeCityArgs {
  overrideCity: string | null;
  defaultCity: string | null;
  availableCities: string[];
}

// Precedence for what "/" shows: an active session override wins, then the
// player's stored default, then null (meaning "render the full city list").
// A stored value that no longer appears in availableCities (its city's last
// club closed) is treated the same as unset, not an error.
export function resolveHomeCity({
  overrideCity,
  defaultCity,
  availableCities,
}: ResolveHomeCityArgs): string | null {
  if (overrideCity && availableCities.includes(overrideCity)) return overrideCity;
  if (defaultCity && availableCities.includes(defaultCity)) return defaultCity;
  return null;
}

// Shared validator for every write path that accepts a city from a form
// (setDefaultCity, setCityOverride, updateProfile's default_city field) --
// rejects a raw POST supplying a value never offered in that path's own
// <select>, including one that was valid when the page rendered but whose
// last club has since closed.
export function isKnownCity(city: string, availableCities: string[]): boolean {
  return availableCities.includes(city);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- cityGrouping`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cityGrouping.ts src/lib/cityGrouping.test.ts
git commit -m "Add resolveHomeCity/isKnownCity pure logic for city personalization"
```

---

### Task 3: Shared cities query helper

**Files:**
- Create: `src/lib/cities.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `listActiveCities(supabase: SupabaseClient): Promise<string[]>`, `CITY_OVERRIDE_COOKIE: string` — both exported from `src/lib/cities.ts`. Tasks 4, 7, 8, and 9 import these by these exact names.

No unit test for this file — it's a thin Supabase query wrapper with no branching logic to verify in isolation, matching the existing convention (`src/lib/orgMembership.ts` is the same shape and has no test file).

- [ ] **Step 1: Write the file**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// Name of the session cookie that overrides a signed-in user's stored
// default_city (or stands alone for a signed-out visitor) for the rest of
// the browser session. Shared between the Server Actions that write it
// (src/app/actions/cityPreference.ts) and the home page that reads it
// (src/app/page.tsx) so the name can't drift between the two.
export const CITY_OVERRIDE_COOKIE = "city_override";

// Distinct cities with at least one active-court location, alphabetical --
// the same "which cities can a player pick" set used by the home page's
// personalization fallback, /choose-city, /profile's default-city field,
// and every write path's validation (isKnownCity, src/lib/cityGrouping.ts).
export async function listActiveCities(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("locations")
    .select("city, courts!inner(id, is_active)")
    .eq("courts.is_active", true);

  const cities = new Set<string>();
  for (const row of data ?? []) {
    if (row.city) cities.add(row.city);
  }
  return Array.from(cities).sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cities.ts
git commit -m "Add listActiveCities helper and city_override cookie constant"
```

---

### Task 4: City preference Server Actions

**Files:**
- Create: `src/app/actions/cityPreference.ts`

**Interfaces:**
- Consumes: `listActiveCities` (Task 3); `isKnownCity` (Task 2). The redirect-to-login target below is a hardcoded literal (`/login?next=/choose-city`), not user input, so unlike `updateProfile` this file has no need for `isSafeRedirectPath`.
- Produces: `setDefaultCity(formData: FormData)`, `skipCityPrompt()`, `setCityOverride(formData: FormData)`, `clearCityOverride()` — all exported Server Actions from `src/app/actions/cityPreference.ts`. Task 6 uses `setCityOverride` (as a form `action`), Task 7 uses `clearCityOverride` (as a form `action`), Task 8 uses `setDefaultCity` and `skipCityPrompt` (as form `action`s).

No unit tests for this file — Server Actions in this codebase aren't unit tested (see `updateProfile`, `cancelBooking`, etc.); they're verified manually in Task 10.

- [ ] **Step 1: Write the file**

```ts
"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities, CITY_OVERRIDE_COOKIE } from "@/lib/cities";
import { isKnownCity } from "@/lib/cityGrouping";

// Called from /choose-city (the one-time first-login prompt). Sets the
// player's stored default and lands them on that city's page.
export async function setDefaultCity(formData: FormData) {
  const city = String(formData.get("city") || "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  const availableCities = await listActiveCities(supabase);
  if (!city || !isKnownCity(city, availableCities)) {
    redirect(`/choose-city?error=${encodeURIComponent("Pick a valid city.")}`);
  }

  await supabase.from("users").update({ default_city: city }).eq("id", user.id);

  redirect(`/cities/${encodeURIComponent(city)}`);
}

// Called from /choose-city's "Skip for now". Permanent -- the prompt never
// reappears on a later login once this is set, per the approved design.
export async function skipCityPrompt() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  await supabase.from("users").update({ city_prompt_dismissed: true }).eq("id", user.id);

  redirect("/");
}

// Called by clicking a city on the full /cities list (AllCitiesContent).
// Works for signed-out visitors too -- it's a plain session cookie, not an
// account edit, so no auth check is needed here.
export async function setCityOverride(formData: FormData) {
  const city = String(formData.get("city") || "").trim();

  const supabase = await createClient();
  const availableCities = await listActiveCities(supabase);
  if (!city || !isKnownCity(city, availableCities)) {
    redirect("/cities");
  }

  const cookieStore = await cookies();
  cookieStore.set(CITY_OVERRIDE_COOKIE, city, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  redirect(`/cities/${encodeURIComponent(city)}`);
}

// Called from "/"'s "Reset to my city" / "Clear" link. Only ever removes
// the session override -- never touches the stored default_city.
export async function clearCityOverride() {
  const cookieStore = await cookies();
  cookieStore.delete(CITY_OVERRIDE_COOKIE);
  redirect("/");
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/cityPreference.ts
git commit -m "Add setDefaultCity/skipCityPrompt/setCityOverride/clearCityOverride actions"
```

---

### Task 5: Extract `CityContent`, update `/cities/[city]`

**Files:**
- Create: `src/components/CityContent.tsx`
- Modify: `src/app/cities/[city]/page.tsx` (full rewrite — current content read in full during planning)

**Interfaces:**
- Consumes: nothing new from this plan's earlier tasks.
- Produces: `CityContent({ city }: { city: string })` (default export, async server component) from `src/components/CityContent.tsx`. Task 7 renders this directly on the personalized home page.

No unit test — this is a Server Component with a data fetch and JSX, the same shape as the page it's extracted from (which was never unit tested either); verified manually in Task 10.

- [ ] **Step 1: Create `CityContent`**

This is `/cities/[city]/page.tsx`'s current body (data fetch through the closing `</>`), with the `notFound()` call kept — it still 404s the whole route when called from a nested component, exactly matching today's behavior for `/cities/[city]`. Rendering the outer wrapper `<div>`, the "&larr; All cities" link, and the `<h1>{city}</h1>` becomes the caller's job (Task 5 Step 2, and Task 7) so each page keeps exactly one `<h1>`.

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clubsInCity } from "@/lib/cityGrouping";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function CityContent({ city }: { city: string }) {
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

  const { data: allEvents } = await supabase
    .from("events")
    .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
    .neq("status", "draft")
    .neq("status", "cancelled");

  const eventsInCity = (allEvents ?? [])
    .map((e) => {
      const eventLocation = Array.isArray(e.location) ? e.location[0] : e.location;
      return {
        id: e.id,
        title: e.title,
        eventType: e.event_type,
        city: eventLocation?.city ?? null,
        sessions: e.event_sessions,
      };
    })
    .filter((e) => e.city === city);

  const upcomingEvents = sortBySoonestSession(eventsInCity, new Date());

  return (
    <>
      {upcomingEvents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-medium">Events in {city}</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {upcomingEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded border border-gray-300 px-4 py-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium">Clubs</h2>

      <ul className="mt-2 flex flex-col gap-3">
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
    </>
  );
}
```

- [ ] **Step 2: Rewrite `/cities/[city]/page.tsx` to use it**

The back link changes from `/` to `/cities` (`/` can now be personalized to a different city — see Task 7 — so it's no longer the right "back to everything" target).

```tsx
import Link from "next/link";
import CityContent from "@/components/CityContent";

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: cityParam } = await params;
  const city = decodeURIComponent(cityParam);

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/cities" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{city}</h1>

      <CityContent city={city} />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CityContent.tsx src/app/cities/\[city\]/page.tsx
git commit -m "Extract CityContent component from /cities/[city]"
```

---

### Task 6: Extract `AllCitiesContent`, add `/cities`

**Files:**
- Create: `src/components/AllCitiesContent.tsx`
- Create: `src/app/cities/page.tsx`

**Interfaces:**
- Consumes: `setCityOverride` (Task 4).
- Produces: `AllCitiesContent()` (default export, async server component, no props) from `src/components/AllCitiesContent.tsx`. Task 7 renders this directly as the home page's non-personalized fallback.

No unit test — same reasoning as Task 5.

- [ ] **Step 1: Create `AllCitiesContent`**

This is today's `/page.tsx` body (the fetch, plus everything inside the outer `<div>` except the `<h1>` itself), with one behavior change: each city entry becomes a small form posting to `setCityOverride` instead of a plain `<Link>`, so picking a city from the full list also starts a session-scoped override — the same action Task 4 wired up. The "Other locations" section (locations with no `city` set) is unaffected — there's no city to override with, so those stay plain links.

```tsx
import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildMapsUrl } from "@/lib/maps";
import { groupLocationsByCity } from "@/lib/cityGrouping";
import { setCityOverride } from "@/app/actions/cityPreference";

export default async function AllCitiesContent() {
  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: locations } = await supabase
    .from("locations")
    .select(
      "id, name, address, city, latitude, longitude, organization:organizations(id, name), courts!inner(id, is_active)"
    )
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
    <>
      {cities.length === 0 && sortedOtherLocations.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No locations available yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {cities.map((cityGroup) => (
          <li key={cityGroup.city}>
            <form action={setCityOverride}>
              <input type="hidden" name="city" value={cityGroup.city} />
              <button
                type="submit"
                className="block w-full rounded border border-gray-300 px-4 py-3 text-left hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
              >
                <p className="font-medium">{cityGroup.city}</p>
                <p className="text-sm text-gray-600">
                  {cityGroup.clubCount} club{cityGroup.clubCount === 1 ? "" : "s"}
                </p>
              </button>
            </form>
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
    </>
  );
}
```

- [ ] **Step 2: Create the `/cities` route**

```tsx
import AllCitiesContent from "@/components/AllCitiesContent";

export default function CitiesPage() {
  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
      <AllCitiesContent />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AllCitiesContent.tsx src/app/cities/page.tsx
git commit -m "Extract AllCitiesContent component and add /cities route"
```

---

### Task 7: Personalize the home page

**Files:**
- Modify: `src/app/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `resolveHomeCity` (Task 2); `listActiveCities`, `CITY_OVERRIDE_COOKIE` (Task 3); `clearCityOverride` (Task 4); `CityContent` (Task 5); `AllCitiesContent` (Task 6).
- Produces: nothing new consumed elsewhere in this plan — this is the top of the tree.

No unit test — same reasoning as Tasks 5–6.

- [ ] **Step 1: Rewrite `src/app/page.tsx`**

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities, CITY_OVERRIDE_COOKIE } from "@/lib/cities";
import { resolveHomeCity } from "@/lib/cityGrouping";
import { clearCityOverride } from "@/app/actions/cityPreference";
import CityContent from "@/components/CityContent";
import AllCitiesContent from "@/components/AllCitiesContent";

export default async function Home() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const overrideCity = cookieStore.get(CITY_OVERRIDE_COOKIE)?.value ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultCity: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("default_city")
      .eq("id", user.id)
      .maybeSingle();
    defaultCity = profile?.default_city ?? null;
  }

  const availableCities = await listActiveCities(supabase);
  const resolvedCity = resolveHomeCity({ overrideCity, defaultCity, availableCities });

  if (!resolvedCity) {
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
        <AllCitiesContent />
      </div>
    );
  }

  const overrideDiffersFromDefault = overrideCity === resolvedCity && overrideCity !== defaultCity;

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

      <div className="mt-2 flex items-center justify-between text-sm text-gray-600 dark:text-neutral-400">
        <span>Browsing: {resolvedCity}</span>
        <span className="flex items-center gap-3">
          <Link href="/cities" className="underline">
            See all cities
          </Link>
          {overrideDiffersFromDefault && (
            <form action={clearCityOverride}>
              <button type="submit" className="underline">
                {defaultCity ? "Reset to my city" : "Clear"}
              </button>
            </form>
          )}
        </span>
      </div>

      <CityContent city={resolvedCity} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "Personalize the home page via resolveHomeCity"
```

---

### Task 8: First-login prompt (`/choose-city`) + `signIn()` wiring

**Files:**
- Create: `src/app/choose-city/page.tsx`
- Modify: `src/app/actions/auth.ts:30-38` (the `signIn` function's tail, shown in full below for exact context)

**Interfaces:**
- Consumes: `listActiveCities` (Task 3); `setDefaultCity`, `skipCityPrompt` (Task 4).

No unit test — same reasoning as prior page/action tasks.

- [ ] **Step 1: Create `/choose-city`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities } from "@/lib/cities";
import { setDefaultCity, skipCityPrompt } from "@/app/actions/cityPreference";

export default async function ChooseCityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  const cities = await listActiveCities(supabase);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Pick Your Home City</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-neutral-400">
        We&apos;ll show you clubs in this city by default when you visit Find a Court. You can
        change this anytime from your profile.
      </p>

      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {cities.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">No cities available yet.</p>
      ) : (
        <form action={setDefaultCity} className="mt-6 flex flex-col gap-3">
          <select
            name="city"
            defaultValue=""
            required
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="" disabled>
              -- select a city --
            </option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
            Set my city
          </button>
        </form>
      )}

      <form action={skipCityPrompt} className="mt-3">
        <button type="submit" className="text-sm underline">
          Skip for now
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire the redirect into `signIn()`**

Current tail of `signIn()` in `src/app/actions/auth.ts`:

```ts
  if (next && isSafeRedirectPath(next)) {
    redirect(next);
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  redirect(membership ? "/admin" : "/");
}
```

Replace it with:

```ts
  if (next && isSafeRedirectPath(next)) {
    redirect(next);
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  if (membership) {
    redirect("/admin");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("default_city, city_prompt_dismissed")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile && !profile.default_city && !profile.city_prompt_dismissed) {
    redirect("/choose-city");
  }

  redirect("/");
}
```

This only changes the plain-login path (no `next` deep link, not an org member) — the `next`-redirect and admin-redirect branches are untouched, matching the spec.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/choose-city/page.tsx src/app/actions/auth.ts
git commit -m "Add first-login city prompt and wire it into signIn()"
```

---

### Task 9: `/profile` Default City field

**Files:**
- Modify: `src/app/profile/page.tsx` (full rewrite — current content read in full during planning)
- Modify: `src/app/actions/profile.ts` (full rewrite)

**Interfaces:**
- Consumes: `listActiveCities` (Task 3); `isKnownCity` (Task 2).

No unit test — `updateProfile` was never unit tested either; verified manually in Task 10.

- [ ] **Step 1: Rewrite `src/app/profile/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/app/actions/profile";
import { listActiveCities } from "@/lib/cities";
import SkillLevelPicker from "@/components/SkillLevelPicker";
import SuccessBanner from "@/components/SuccessBanner";
import { isProfileComplete } from "@/lib/userProfile";
import { isSafeRedirectPath } from "@/lib/redirects";

const FIELD_LABELS: { key: "name" | "gender" | "skill_level"; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "gender", label: "Gender" },
  { key: "skill_level", label: "Level of play" },
];

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; saved?: string; error?: string }>;
}) {
  const { next: rawNext, message, saved, error } = await searchParams;
  const next = rawNext && isSafeRedirectPath(rawNext) ? rawNext : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginNext = next ? `/profile?next=${encodeURIComponent(next)}` : "/profile";
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("name, gender, skill_level, share_stats_publicly, default_city")
    .eq("id", user.id)
    .single();

  const availableCities = await listActiveCities(supabase);

  const missingFields = profile
    ? FIELD_LABELS.filter((f) => !profile[f.key]).map((f) => f.label)
    : FIELD_LABELS.map((f) => f.label);
  const profileIncomplete = !profile || !isProfileComplete(profile);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Profile</h1>

      {message && <SuccessBanner>{message}</SuccessBanner>}
      {saved && <SuccessBanner>Profile saved.</SuccessBanner>}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {profileIncomplete && (
        <p className="mt-4 rounded bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
          Still missing: {missingFields.join(", ")}
        </p>
      )}

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
        {next && <input type="hidden" name="next" value={next} />}
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" defaultValue={profile?.name ?? ""} className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Gender
          <select
            name="gender"
            defaultValue={profile?.gender ?? ""}
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="">-- select --</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Level of play
          <SkillLevelPicker defaultValue={profile?.skill_level ?? null} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Default city
          <select
            name="default_city"
            defaultValue={profile?.default_city ?? ""}
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="">-- none --</option>
            {availableCities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-600 dark:text-neutral-400">
            Shown by default when you visit Find a Court.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="share_stats_publicly"
            defaultChecked={profile?.share_stats_publicly ?? false}
            className="mt-0.5"
          />
          <span>
            Share my stats publicly
            <span className="block text-xs text-gray-600 dark:text-neutral-400">
              Shows your name, skill level, and win/loss record on a public
              page anyone with the link can view. Off by default.
            </span>
          </span>
        </label>
        <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/app/actions/profile.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/lib/redirects";
import { listActiveCities } from "@/lib/cities";
import { isKnownCity } from "@/lib/cityGrouping";

const VALID_GENDERS = new Set(["male", "female", "prefer_not_to_say"]);
const VALID_SKILL_LEVELS = new Set(["Recreational", "B", "BB", "A", "AA", "Open"]);

export async function updateProfile(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const skillLevel = String(formData.get("skill_level") || "").trim();
  const shareStatsPublicly = formData.get("share_stats_publicly") === "on";
  const defaultCity = String(formData.get("default_city") || "").trim();
  const rawNext = String(formData.get("next") || "");
  const next = isSafeRedirectPath(rawNext) ? rawNext : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  // Client-side <select>s already constrain these, but nothing stops a raw
  // POST from supplying an out-of-set value -- reject before ever touching
  // the database rather than relying on the DB check constraint to fail.
  if ((gender && !VALID_GENDERS.has(gender)) || (skillLevel && !VALID_SKILL_LEVELS.has(skillLevel))) {
    redirect(`/profile?error=${encodeURIComponent("Invalid profile value.")}`);
  }

  // default_city has no fixed enum -- it must match one of the cities
  // currently offered by this same page's own <select> (isKnownCity,
  // src/lib/cityGrouping.ts), checked live rather than against a stale
  // client-supplied list.
  if (defaultCity) {
    const availableCities = await listActiveCities(supabase);
    if (!isKnownCity(defaultCity, availableCities)) {
      redirect(`/profile?error=${encodeURIComponent("Invalid profile value.")}`);
    }
  }

  const { data: updated, error } = await supabase
    .from("users")
    .update({
      name: name || null,
      gender: gender || null,
      skill_level: skillLevel || null,
      share_stats_publicly: shareStatsPublicly,
      default_city: defaultCity || null,
    })
    .eq("id", user.id)
    .select("id");

  if (error) {
    redirect(`/profile?error=${encodeURIComponent("Couldn't save your profile. Try again.")}`);
  }

  // Mirrors the zero-row check in cancelEventRegistration
  // (src/app/actions/events.ts) -- an update matching no row (e.g. no
  // users row exists for this account, which shouldn't happen given the
  // signup trigger but isn't guaranteed) returns no error, so it must be
  // checked separately to avoid a false "saved" redirect.
  if (!updated || updated.length === 0) {
    redirect(
      `/profile?error=${encodeURIComponent("Couldn't find your account. Try signing in again.")}`
    );
  }

  revalidatePath("/profile");
  revalidatePath("/");

  if (next) {
    const separator = next.includes("?") ? "&" : "?";
    redirect(`${next}${separator}message=${encodeURIComponent("Profile saved.")}`);
  }

  redirect("/profile?saved=1");
}
```

Note the one added line beyond the new field itself: `revalidatePath("/")` — the home page now reads `default_city`, so changing it needs to invalidate `/`'s cache the same way `/profile` already invalidates its own.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/page.tsx src/app/actions/profile.ts
git commit -m "Add Default City field to /profile"
```

---

### Task 10: Manual end-to-end verification

No code changes. Run the full test suite once, then walk through the flows below in the browser (`npm run dev`). Use a fresh signup (e.g. `city-test@courtscheduler.dev` / any password) so the first-login prompt is guaranteed to trigger — the existing seeded `test.player@courtscheduler.dev` account may already have `city_prompt_dismissed` or `default_city` set from earlier manual testing.

- [ ] **Step 1: Full suite**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 2: First-login prompt + skip**

Sign up a fresh account, confirm the email (or use the project's existing email-confirmation workaround), sign in. Confirm you land on `/choose-city`, not `/`. Click "Skip for now". Confirm you land on `/` and see the full city list (today's behavior, unchanged). Sign out, sign back in. Confirm you land on `/` directly this time — the prompt does not reappear (permanent skip).

- [ ] **Step 3: First-login prompt + set a city**

Sign up a second fresh account, sign in, land on `/choose-city`. Pick a city with at least one club and click "Set my city". Confirm you land on `/cities/<that city>`. Sign out, sign back in. Confirm you land on `/` directly (no `/choose-city`) and `/` shows that city's clubs/events with a "Browsing: {city} · See all cities" line — no "Reset"/"Clear" link should be visible (no override active, just the stored default).

- [ ] **Step 4: Session override**

While signed in as the account from Step 3, click "See all cities" → confirm you're on `/cities` (full list) and your default city's card still appears there like every other city. Pick a *different* city. Confirm you land on that city's `/cities/<city>` page, and that navigating back to `/` now shows the override city with a "Reset to my city" link visible. Click "Reset to my city". Confirm `/` reverts to the original default city and the reset link disappears.

- [ ] **Step 5: Signed-out override**

Sign out. From `/cities`, pick any city. Confirm `/` now shows that city (with a "Clear" link, since there's no signed-in default to fall back to). Click "Clear". Confirm `/` reverts to the full city list.

- [ ] **Step 6: `/profile` edit**

Sign back in as the Step 3 account (no active override). Go to `/profile`, change "Default city" to a different city, save. Confirm the success message appears and `/` now shows the newly-chosen city.

- [ ] **Step 7: Stale-city fallback**

Temporarily set every court at every location in one city to `is_active = false` (via the admin UI, on a city you're not relying on for other testing) while that city is someone's stored default or active override. Confirm `/` falls back to the full city list instead of erroring or showing an empty city page. Reactivate the courts afterward.

- [ ] **Step 8: `/cities/[city]`'s back link**

While signed in with a personalized `/`, navigate to any city page directly (e.g. via a link from `/clubs/[orgId]` if one exists, or by typing the URL) and confirm "&larr; All cities" goes to `/cities` (the full list), not back to your personalized `/`.

- [ ] **Step 9: Update the status log**

Add an entry to `docs/STATUS.md` describing what shipped, in this repo's existing style (what was built, key file references, what was verified, anything deliberately deferred). Then commit:

```bash
git add docs/STATUS.md
git commit -m "Document city-scoped signup personalization"
```
