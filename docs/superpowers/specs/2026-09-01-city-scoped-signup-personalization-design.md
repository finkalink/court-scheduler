# City-Scoped Signup Personalization — Design

## Background

The player-facing home page (`/`) currently lists every city that has at least
one club with an active court, with no personalization — see the City > Club
> Location > Court drilldown shipped earlier (`docs/STATUS.md`). The original
backlog item also wanted: a default city picked at signup, `/` defaulting to
that city, and a session-scoped switcher to browse elsewhere without changing
the stored default. That item was only partially shipped (the navigational
hierarchy); this spec covers the remaining personalization half.

Two prerequisites the original backlog flagged as blockers are already
resolved: `locations.city` exists (`supabase/migrations/0013_location_city.sql`),
and a real user profile row exists (`users.name`/`gender`/`skill_level`,
`/profile`, `docs/superpowers/specs/2026-09-01-user-profiles-design.md`).

**A constraint carried over from two earlier features:** `supabase.auth.signUp()`
does not establish an authenticated session in this app (email confirmation is
required before login works), so a `security definer` RPC or a direct
authenticated write cannot happen inside `signUp()` itself. The team-roster-invite
plan and the user-profiles plan both hit this and moved their writes to `signIn()`
or to a page reached only once signed in. This plan does the same: "set at
signup" becomes "set at first login."

## Data model

Two new nullable/defaulted columns on `users` (new migration, no backfill —
matches the existing convention for `slot_size_minutes`, geocoding columns,
etc.):

```sql
alter table users add column default_city text;
alter table users add column city_prompt_dismissed boolean not null default false;
```

`default_city` is free text, not a foreign key or enum — it must match one of
the cities currently returned by the same "distinct cities with at least one
active-court location" query the home page already runs. That set changes as
clubs/locations come and go, so it's validated server-side at write time (same
"reject before touching the database" pattern `updateProfile` already uses for
`gender`/`skill_level` against a fixed set — here the set is dynamic instead of
fixed) rather than as a DB check constraint. `city_prompt_dismissed` needs no
validation.

Neither column is identity-sensitive, so both stay outside the `0023_protect_users_identity_columns.sql`
trigger's protected set — a player can self-edit them like `name`/`gender`/`skill_level`.

If a stored `default_city` (or, later, an override — see below) stops having
any active locations, nothing cleans it up. Render-time logic falls back
gracefully (see "Home page precedence" below) rather than erroring — the same
"no backfill, handle staleness at read time" convention already used for
`locations.city` being null on unverified addresses.

## First-login prompt

`signIn()` (`src/app/actions/auth.ts`) already branches on org membership at
its end:

```ts
redirect(membership ? "/admin" : "/");
```

That branch gains one more condition, evaluated only for the non-member
(player) path — the admin redirect and the pre-existing `next`-param
short-circuit are both untouched:

- If the signed-in user has `default_city IS NULL` and
  `city_prompt_dismissed = false`, redirect to `/choose-city` instead of `/`.
- Otherwise, `/` as today.

This costs one extra `users` row fetch in `signIn()`, alongside the
`org_members` lookup already there.

`/choose-city` (new page, new route):
- A `<select>` of every city currently returned by the shared "cities with an
  active-court location" query (same data source `/` and `/cities` use — see
  below), sorted the same way.
- "Set my city" submit → `setDefaultCity` action (new, `src/app/actions/cityPreference.ts`):
  validates the submitted city against the live set, writes `default_city`,
  redirects to `/cities/[city]`.
- "Skip for now" → `skipCityPrompt` action (same file): sets
  `city_prompt_dismissed = true`, redirects to `/`. Per the approved design,
  skipping is **permanent** — it will not reappear on a later login. The
  field remains editable afterward from `/profile` (below), so skipping isn't
  a dead end.
- No role-gating beyond "signed in" — an org admin who also browses as a
  player would see this too if they somehow reached the player redirect
  branch, but in practice admins always take the `/admin` branch, so this is
  moot in the current app.

## `/profile` gets a Default City field

Folded into the existing form/action rather than a parallel one — one more
`<select>` next to Gender/Level of Play, same submit button. `updateProfile`
(`src/app/actions/profile.ts`) gains a `default_city` field, validated the
same way `setDefaultCity` does (shared validator, see "Shared logic" below).
Leaving it blank clears `default_city` (same "empty string → null" convention
already used for `gender`/`skill_level` in that action).

## Home page personalization

**New route: `/cities`** (plural, no dynamic segment) gets today's `/`
rendering verbatim — the full city list plus the "Other locations" fallback
for locations with no `city` set. This becomes the permanent "see everything,
no personalization" view, and the target of every "see all cities" link.

**`/` becomes conditional**, evaluated in this order:

1. If a `city_override` cookie (see below) is present and that city still
   appears in the live active-city set → render that city's content.
2. Else if the signed-in user has a `default_city` that still appears in the
   live active-city set → render that city's content.
3. Else → render `/cities`' content (today's `/`, unchanged) — this covers
   signed-out visitors, players with no city set, and the stale-reference case
   (a stored city that no longer has any active club).

"That city's content" (clubs in the city + upcoming events in the city) is
exactly what `/cities/[city]/page.tsx` already renders. That rendering is
pulled into one shared async server component, `CityContent({ city })`
(new, e.g. `src/components/CityContent.tsx`), that both `/cities/[city]/page.tsx`
and the personalized `/` render, so there is exactly one implementation of "a
city's clubs and events" rather than two copies drifting apart. `/cities/[city]`
keeps its own "&larr; All cities" link, pointed at `/cities` (not `/`, since `/`
may now be personalized to a different city than the one being viewed).

The personalized `/` adds one small header line above the existing content:
"Browsing: {city} · [See all cities]" — the link points to `/cities`. When an
active override differs from the stored default (or exists with no stored
default), a "Reset to my city" (or, with no default, "Clear") link is also
shown, clearing the cookie and redirecting back to `/`.

## Session override (cookie)

The override is set **explicitly**, not as a side effect of ordinary
navigation — visiting `/cities/[city]` from a breadcrumb or an old link never
writes anything. Only picking a city from the full `/cities` list does:

- Each city entry on `/cities` becomes a small form (not a plain `<Link>`)
  posting to a new `setCityOverride` action (`cityPreference.ts`): sets a
  `city_override` cookie to that city name and redirects to `/cities/[city]`.
- The cookie is a **browser session cookie** — no `maxAge`/`expires` set, so
  it clears when the browser closes, matching "session override, not account
  edit." `httpOnly: true`, `sameSite: "lax"`, `path: "/"`.
- `/` reads it via `(await cookies()).get("city_override")?.value` (Next's
  `next/headers`, already used by the Supabase server client).
- Clearing it ("Reset to my city") deletes the cookie via the same action file
  and redirects to `/`.

This works for signed-out visitors too — a signed-out visitor who picks a
city from `/cities` gets `/` scoped to it for the rest of the browser session
(rule 1 above doesn't require a signed-in user), even though they have no
`default_city` to fall back to.

## Shared logic (new, test-first)

`src/lib/cityGrouping.ts` gains:

- `resolveHomeCity({ overrideCity, defaultCity, availableCities }): string | null` —
  pure function implementing the three-step precedence above (returns `null`
  to mean "render the full list"). Covers: override wins when valid, falls
  back to default when valid, falls back to `null` when neither is valid
  (including the stale-reference case where a stored city no longer appears
  in `availableCities`).
- `isKnownCity(city, availableCities): boolean` — the shared validator used by
  `setDefaultCity`, `updateProfile`, and `setCityOverride` before writing
  anything, so all three reject the same way an out-of-set value they didn't
  offer in their own `<select>` (a raw POST, a stale dropdown from before a
  city's last club closed).

Both are pure and unit-tested per this project's TDD convention, the same way
`groupLocationsByCity`/`clubsInCity` already are.

## Out of scope

- Metro-area clustering or geolocation-based suggestions — city stays exactly
  the string already stored on `locations.city` from the geocoding flow.
- Org admins get no separate personalization; this only affects the
  player-facing `/` and the post-login redirect for non-members.
- Re-prompting after a permanent skip (e.g. a "set your city" nudge elsewhere)
  — not asked for; `/profile` remains the only way back in after skipping.
