# Public-Facing Player Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player opt in, from `/profile`, to a public page at
`/players/[userId]` showing their name, skill level, and all-time
win/loss/games-played tally — then link to that page from wherever their
name already appears publicly (team rosters, bracket match cards,
standings tables).

**Architecture:** One new `users.share_stats_publicly` boolean (opt-in,
default off) plus one `security definer` Postgres function,
`get_public_player_stats`, that returns a player's stats only if they've
opted in and is otherwise indistinguishable from "no such user" — the
entire win/loss aggregation lives in that one SQL function, computed live
from `event_registrations`/`event_team_members`/`event_matches`, nothing
pre-computed or cached. The new `/players/[userId]` page is a thin
wrapper that calls it. The existing event detail page
(`src/app/events/[eventId]/page.tsx`), which already renders both the
Rosters section (team-roster-visibility work) and the Bracket section
(brackets work) in one file, gets one added batched query to find out
which of the `user_id`s it's about to render have opted in, then renders
those specific names as links.

**Tech Stack:** Next.js server components/actions, Supabase Postgres
(`plpgsql` function, `security definer`) + RLS.

**Spec:** `docs/superpowers/specs/2026-09-01-public-player-profiles-design.md`

## Global Constraints

- No public directory — a profile is reachable only via a link from
  somewhere the player's name was already shown publicly, or by knowing
  the URL. Nothing in this plan adds a browsable/searchable list.
- One toggle only: on shows name + skill level + win/loss tally; off
  shows nothing. Gender is never returned by `get_public_player_stats`
  and never shown on `/players/[userId]`, regardless of the toggle.
- No match history, per-event breakdown, leaderboard, ranking, or
  cross-player comparison — the public page shows only one player's
  aggregate tally.
- `get_public_player_stats(p_user_id)` returns an empty result set
  identically whether `p_user_id` doesn't exist, isn't a valid uuid, or
  exists but hasn't opted in — this can never be used to probe account
  existence. `/players/[userId]` renders the same generic "This profile
  isn't available." message for all three cases.
- A roster or bracket entry with no `user_id` (pending invite,
  pre-migration free-text-only row, or — for bracket rows — a team
  registration, which has `team_id` not `user_id`) never renders as a
  link, regardless of any other player's sharing settings.
- No change to the private `/profile` page's existing behavior for
  name/gender/skill level — this plan only adds one new checkbox and one
  new column to the same existing update.

---

### Task 1: Migration — `share_stats_publicly` column and `get_public_player_stats` RPC

**Files:**
- Create: `supabase/migrations/0024_public_player_profiles.sql`

**Interfaces:**
- Produces: `users.share_stats_publicly` column;
  `public.get_public_player_stats(p_user_id uuid) returns table(name
  text, skill_level text, wins int, losses int, games_played int)`
  (consumed by Tasks 2-3).

- [ ] **Step 1: Write the migration**

```sql
-- Public-facing player profiles. Off by default (opt-in, not opt-out) --
-- editable via the existing self-service "users update own" path; the
-- identity-column protection trigger (0023_protect_users_identity_columns.sql)
-- only blocks email/role, so this stays freely self-editable like
-- name/gender/skill_level already are.
alter table users add column share_stats_publicly boolean not null default false;

-- Returns a player's public stats ONLY if they've opted in -- an empty
-- result set is returned identically whether p_user_id doesn't exist OR
-- exists but hasn't opted in, so this can never be used to probe account
-- existence (same care already taken with find_registered_user_by_email,
-- 0021_team_roster_invites.sql). Granted to anon as well as authenticated
-- -- this page works for a signed-out visitor, matching every other
-- player-facing page in this app.
create function public.get_public_player_stats(p_user_id uuid)
returns table(name text, skill_level text, wins int, losses int, games_played int)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_name text;
  v_skill_level text;
  v_opted_in boolean;
begin
  select u.name, u.skill_level, u.share_stats_publicly
  into v_name, v_skill_level, v_opted_in
  from users u
  where u.id = p_user_id;

  if v_opted_in is not true then
    return;
  end if;

  return query
  with my_registrations as (
    -- Every event_registrations row this player is credited for: their
    -- own direct individual registrations, plus every team registration
    -- for any team they've ever been a roster member of.
    select er.id from event_registrations er where er.user_id = p_user_id
    union
    select er.id
    from event_registrations er
    join event_team_members m on m.team_id = er.team_id
    where m.user_id = p_user_id
  ),
  my_matches as (
    select em.winner_registration_id
    from event_matches em
    where em.status = 'completed'
      and em.is_bye = false -- a bye isn't a game played -- nobody actually played
      and (em.team_a_registration_id in (select id from my_registrations)
        or em.team_b_registration_id in (select id from my_registrations))
      -- forfeits ARE included -- a recorded forfeit is a real win/loss,
      -- same as how real sports standings treat it
  )
  select
    v_name,
    v_skill_level,
    count(*) filter (where winner_registration_id in (select id from my_registrations))::int,
    count(*) filter (where winner_registration_id is not null and winner_registration_id not in (select id from my_registrations))::int,
    count(*)::int
  from my_matches;
end;
$$;

grant execute on function public.get_public_player_stats(uuid) to anon, authenticated;
```

No new RLS policy — `share_stats_publicly` is covered by the existing
`users update own`/`users select own` policies for the owner; everyone
else reads it only indirectly, through this function, which enforces the
opt-in check itself before returning anything.

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0024_public_player_profiles.sql`

- [ ] **Step 3: Verify against the live database**

As a real test account with completed match history (e.g.
`test.player@courtscheduler.dev`, or another account used in prior
manual verification of the brackets/registration work), confirm:

- `select get_public_player_stats(id) from users where id = '<that
  account's user id>'` returns nothing while `share_stats_publicly` is
  still `false` (the default).
- `update users set share_stats_publicly = true where id = '<that
  account's user id>'` then re-running the same `select` returns exactly
  one row with the account's real name, skill level, and win/loss/games
  numbers — cross-check the numbers by hand against known match results
  for that account if any exist, or confirm `0-0, 0 games played` if not.
- `select get_public_player_stats(gen_random_uuid())` (a syntactically
  valid but nonexistent uuid) returns nothing, indistinguishable in shape
  from the opted-out case above.
- `select get_public_player_stats('not-a-uuid')` — confirm this either
  errors or returns nothing, and note which, so Task 3's page can handle
  it (a malformed `userId` route param reaches this exact call).
- Set `share_stats_publicly` back to `false` when done, so the test
  account's default state is restored for later manual verification
  passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0024_public_player_profiles.sql
git commit -m "Add share_stats_publicly column and get_public_player_stats RPC"
```

---

### Task 2: Profile toggle

**Files:**
- Modify: `src/app/actions/profile.ts`
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `users.share_stats_publicly` from Task 1.
- No new exports — extends `updateProfile`'s existing form-data contract
  with one new field (`share_stats_publicly`, a checkbox) and the
  existing profile query/update with one new column.

- [ ] **Step 1: Read and persist the checkbox in `updateProfile`**

In `src/app/actions/profile.ts`, add the new field read right after the
existing three:

```ts
  const name = String(formData.get("name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const skillLevel = String(formData.get("skill_level") || "").trim();
  const shareStatsPublicly = formData.get("share_stats_publicly") === "on";
  const rawNext = String(formData.get("next") || "");
```

(A checkbox's value is only present in `FormData` at all when checked,
and its value is the literal string `"on"` when no explicit `value`
attribute is set — an unchecked box means `formData.get(...)` returns
`null`, so this reads as `false` with no extra branching needed.)

Add `share_stats_publicly: shareStatsPublicly` to the existing `.update({
... })` call's object, alongside `name`/`gender`/`skill_level`:

```ts
  const { data: updated, error } = await supabase
    .from("users")
    .update({
      name: name || null,
      gender: gender || null,
      skill_level: skillLevel || null,
      share_stats_publicly: shareStatsPublicly,
    })
    .eq("id", user.id)
    .select("id");
```

Everything else in the file (the `VALID_GENDERS`/`VALID_SKILL_LEVELS`
guard, the zero-row check, the redirect logic) is unchanged — there's no
invalid value to guard against for a plain boolean.

- [ ] **Step 2: Add the checkbox to the profile form**

In `src/app/profile/page.tsx`, add `share_stats_publicly` to the existing
profile `select(...)` call:

```tsx
  const { data: profile } = await supabase
    .from("users")
    .select("name, gender, skill_level, share_stats_publicly")
    .eq("id", user.id)
    .single();
```

Add the checkbox field right after the existing `Level of play` label
block and before the `Save` button:

```tsx
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
```

Everything else on the page (the `FIELD_LABELS` completeness check, the
banners, the rest of the form) is unchanged — `share_stats_publicly` is
intentionally not part of `isProfileComplete`/`FIELD_LABELS`, since it's
an independent opt-in, not a required field.

- [ ] **Step 3: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same tests as before

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/profile.ts src/app/profile/page.tsx
git commit -m "Add the Share my stats publicly toggle to the profile page"
```

---

### Task 3: Public player page

**Files:**
- Create: `src/app/players/[userId]/page.tsx`

**Interfaces:**
- Consumes: `get_public_player_stats` from Task 1.
- No new exports — a standalone page route.

- [ ] **Step 1: Write the page**

```tsx
// src/app/players/[userId]/page.tsx
import { createClient } from "@/lib/supabase/server";

export default async function PublicPlayerPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_public_player_stats", {
    p_user_id: userId,
  });

  const stats = !error && data && data.length > 0 ? data[0] : null;

  if (!stats) {
    return (
      <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
        <p className="text-sm text-gray-600 dark:text-neutral-400">
          This profile isn&apos;t available.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">{stats.name ?? "Player"}</h1>
      {stats.skill_level && (
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">{stats.skill_level}</p>
      )}
      <p className="mt-4 text-lg">
        {stats.wins}&ndash;{stats.losses}
      </p>
      <p className="text-sm text-gray-600 dark:text-neutral-400">
        {stats.games_played} game{stats.games_played === 1 ? "" : "s"} played
      </p>
    </div>
  );
}
```

`get_public_player_stats` is `security definer` and granted to `anon`,
so this needs no signed-in check at all — it works identically for a
signed-out visitor, matching `/events/[eventId]` and every other
player-facing page. A malformed `userId` (not a valid uuid) makes the
`rpc` call return an `error` instead of throwing, which the `!error &&
...` check already treats the same as "not available" — no separate
try/catch needed.

- [ ] **Step 2: Run the test suite (regression only — no new tests this task, per the spec's testing plan: this page has no pure logic to unit-test, verified manually instead)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/players/[userId]/page.tsx"
git commit -m "Add the public player stats page at /players/[userId]"
```

---

### Task 4: `MatchCard` — optional profile links

**Files:**
- Modify: `src/components/MatchCard.tsx`

**Interfaces:**
- Produces: two new optional props on `MatchCard`, `sideAHref?: string |
  null` and `sideBHref?: string | null` (consumed by Task 5). Every
  existing caller that doesn't pass them is unaffected — both default to
  `null`, rendering exactly as before.

`MatchCard`'s root element is currently a `<button>` wrapping the whole
card (used to toggle the expanded sets view). A `<Link>` renders an
`<a>`, and nesting an `<a>` inside a `<button>` is invalid HTML — browsers
silently break out of the button when they hit it, corrupting the DOM
structure and the whole card's layout/click behavior. This task swaps the
root to a `<div role="button" tabIndex={0}>` with matching click/keyboard
handling, so the two side-name links can live inside it safely.

- [ ] **Step 1: Rewrite the component**

```tsx
// src/components/MatchCard.tsx
"use client";

import { useState } from "react";
import Link from "next/link";

interface MatchCardProps {
  roundLabel: string;
  sideAName: string;
  sideBName: string;
  sideAHref?: string | null;
  sideBHref?: string | null;
  winnerName: string | null;
  sets: { set_number: number; team_a_points: number; team_b_points: number }[];
  isForfeit: boolean;
  adminNote: string | null;
  sessionSummary: string | null;
}

export default function MatchCard({
  roundLabel,
  sideAName,
  sideBName,
  sideAHref = null,
  sideBHref = null,
  winnerName,
  sets,
  isForfeit,
  adminNote,
  sessionSummary,
}: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((e) => !e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((x) => !x);
        }
      }}
      className="w-56 shrink-0 rounded border border-gray-300 px-3 py-2 text-left text-sm dark:border-neutral-800"
    >
      <p className="text-xs text-gray-600 dark:text-neutral-400">{roundLabel}</p>
      <p className={winnerName === sideAName ? "font-medium" : ""}>
        {sideAHref ? (
          <Link href={sideAHref} onClick={(e) => e.stopPropagation()} className="underline decoration-dotted">
            {sideAName}
          </Link>
        ) : (
          sideAName
        )}
      </p>
      <p className={winnerName === sideBName ? "font-medium" : ""}>
        {sideBHref ? (
          <Link href={sideBHref} onClick={(e) => e.stopPropagation()} className="underline decoration-dotted">
            {sideBName}
          </Link>
        ) : (
          sideBName
        )}
      </p>
      {isForfeit && <p className="text-xs text-gray-600 dark:text-neutral-400">Forfeit</p>}
      {sessionSummary && <p className="text-xs text-gray-600 dark:text-neutral-400">{sessionSummary}</p>}
      {expanded && (
        <div className="mt-2 border-t border-gray-200 pt-2 text-xs dark:border-neutral-700">
          {sets.length === 0 && <p>No sets recorded.</p>}
          {sets.map((s) => (
            <p key={s.set_number}>
              Set {s.set_number}: {s.team_a_points}-{s.team_b_points}
            </p>
          ))}
          {adminNote && <p className="mt-1 italic">{adminNote}</p>}
        </div>
      )}
    </div>
  );
}
```

(The `onClick={(e) => e.stopPropagation()}` on each `Link` stops a click
on a linked name from also toggling the card's expanded state before
navigating away — a minor visual glitch otherwise, not a functional bug,
but free to prevent.)

- [ ] **Step 2: Run the test suite (regression only — no tests exist for this component; the one caller, the event detail page, has no unit tests either per this codebase's convention of not unit-testing page components)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "Let MatchCard render side names as links to public player profiles"
```

---

### Task 5: Link rosters and bracket views to public profiles

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `share_stats_publicly` from Task 1, `sideAHref`/`sideBHref`
  from Task 4.
- No new exports — extends the existing Rosters and Bracket sections on
  the event detail page.

The design spec describes this as two separate pages each doing their
own batched lookup; in this codebase both the Rosters section (from the
team-roster-visibility work) and the Bracket section (from the brackets
work) already live in the same file,
`src/app/events/[eventId]/page.tsx`. This task does one combined batched
query on that shared page instead of two, which satisfies the same
goal — never a per-row query, one lookup covers everything the page is
about to render.

- [ ] **Step 1: Add `user_id` to the `allRegistrations` query**

In `src/app/events/[eventId]/page.tsx`, change the existing
`allRegistrations` query and the `nameByRegistrationId` map it feeds
(this is the block that already exists right before the `matchSessions`
query):

```tsx
  const { data: allRegistrations } = await supabase
    .from("event_registrations")
    .select("id, user_id, display_name, team:event_teams(name)")
    .eq("event_id", eventId);
  const nameByRegistrationId = new Map(
    (allRegistrations ?? []).map((r) => {
      const team = Array.isArray(r.team) ? r.team[0] : r.team;
      return [r.id, team?.name ?? r.display_name ?? "Player"];
    })
  );
```

(Only the `select(...)` string changed, adding `user_id` — the map's
logic is unchanged. `user_id` is `null` on every team registration, by
the table's own `check ((team_id is not null) <> (user_id is not
null))` constraint, so this never accidentally attributes a team's stats
page to one member.)

- [ ] **Step 2: Add the batched opt-in lookup and an href map**

Add this block immediately after the `nameByRegistrationId` declaration
from Step 1, and before the `matchSessions` query:

```tsx
  const rosterUserIds = (teams ?? [])
    .flatMap((t) => t.members.map((m) => m.user_id))
    .filter((id): id is string => Boolean(id));
  const registrationUserIds = (allRegistrations ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => Boolean(id));
  const candidateUserIds = Array.from(new Set([...rosterUserIds, ...registrationUserIds]));

  const { data: publicProfiles } =
    candidateUserIds.length > 0
      ? await supabase.from("users").select("id").in("id", candidateUserIds).eq("share_stats_publicly", true)
      : { data: [] };
  const sharingUserIds = new Set((publicProfiles ?? []).map((p) => p.id));

  const hrefByRegistrationId = new Map(
    (allRegistrations ?? []).map((r) => [
      r.id,
      r.user_id && sharingUserIds.has(r.user_id) ? `/players/${r.user_id}` : null,
    ])
  );
```

(`teams` is the query already declared above this point in the file, for
the Rosters section. `sharingUserIds` covers both roster members and
bracket registrations from one query — the whole point of batching.)

- [ ] **Step 3: Link roster member names**

Replace the existing member-rendering `<li>` inside the Rosters section:

```tsx
                  {team.members.map((m) => (
                    <li key={m.id} className="text-sm text-gray-600 dark:text-neutral-400">
                      {m.user_id && sharingUserIds.has(m.user_id) ? (
                        <Link href={`/players/${m.user_id}`} className="underline decoration-dotted">
                          {m.display_name}
                        </Link>
                      ) : (
                        m.display_name
                      )}
                      {!m.user_id && <span className="ml-1 text-xs italic">(pending)</span>}
                    </li>
                  ))}
```

- [ ] **Step 4: Link elimination-bracket `MatchCard` side names**

In the elimination-tree `<MatchCard ... />` usage, add the two new props:

```tsx
                              <MatchCard
                                key={m.id}
                                roundLabel={`Round ${roundNumber}`}
                                sideAName={nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"}
                                sideBName={nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                                sideAHref={hrefByRegistrationId.get(m.team_a_registration_id ?? "") ?? null}
                                sideBHref={hrefByRegistrationId.get(m.team_b_registration_id ?? "") ?? null}
                                winnerName={m.winner_registration_id ? nameByRegistrationId.get(m.winner_registration_id) ?? null : null}
                                sets={(matchSets ?? []).filter((s) => s.match_id === m.id)}
                                isForfeit={m.is_forfeit}
                                adminNote={m.admin_note}
                                sessionSummary={session ? `${session.label ? session.label + " -- " : ""}${court?.name ?? ""}` : null}
                              />
```

- [ ] **Step 5: Link standings-table names**

Replace the standings table's `<td>{nameByRegistrationId.get(row.registrationId) ?? "Unknown"}</td>`:

```tsx
                        <tr key={row.registrationId}>
                          <td>
                            {hrefByRegistrationId.get(row.registrationId) ? (
                              <Link
                                href={hrefByRegistrationId.get(row.registrationId)!}
                                className="underline decoration-dotted"
                              >
                                {nameByRegistrationId.get(row.registrationId) ?? "Unknown"}
                              </Link>
                            ) : (
                              nameByRegistrationId.get(row.registrationId) ?? "Unknown"
                            )}
                          </td>
                          <td>{row.wins}</td>
                          <td>{row.losses}</td>
                          <td>{row.pointDiff}</td>
                        </tr>
```

- [ ] **Step 6: Link round-robin match-list names**

Replace the non-elimination match list's name paragraph:

```tsx
                          <p>
                            Round {m.round_number} &middot;{" "}
                            {hrefByRegistrationId.get(m.team_a_registration_id ?? "") ? (
                              <Link
                                href={hrefByRegistrationId.get(m.team_a_registration_id ?? "")!}
                                className={winnerName === sideAName ? "font-medium underline decoration-dotted" : "underline decoration-dotted"}
                              >
                                {sideAName}
                              </Link>
                            ) : (
                              <span className={winnerName === sideAName ? "font-medium" : ""}>{sideAName}</span>
                            )}{" "}
                            vs{" "}
                            {hrefByRegistrationId.get(m.team_b_registration_id ?? "") ? (
                              <Link
                                href={hrefByRegistrationId.get(m.team_b_registration_id ?? "")!}
                                className={winnerName === sideBName ? "font-medium underline decoration-dotted" : "underline decoration-dotted"}
                              >
                                {sideBName}
                              </Link>
                            ) : (
                              <span className={winnerName === sideBName ? "font-medium" : ""}>{sideBName}</span>
                            )}
                            {m.is_forfeit && " (forfeit)"}
                          </p>
```

- [ ] **Step 7: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add "src/app/events/[eventId]/page.tsx"
git commit -m "Link rosters and bracket views to opted-in public player profiles"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers
  schema/RPC-level checks).
- As a real test account with completed match history, opt in via
  `/profile` (confirm the new checkbox, its state persisting across
  reloads); confirm `/players/[that-user-id]` shows the correct name,
  skill level, and win/loss/games-played numbers, cross-checked by hand
  against known match results.
- Confirm a player with an incomplete profile (missing name/gender/skill
  level) can still opt in and appears on their public page with
  whatever fields they do have set.
- Confirm a team win/loss is correctly credited to every roster member,
  not just whoever the captain was, by checking two different team
  members' public pages after a team match completes.
- Confirm bye matches never appear in games-played, and a forfeit result
  does appear and counts correctly for both the winner and the player who
  forfeited.
- Toggle sharing off; confirm `/players/[userId]` immediately reverts to
  "This profile isn't available.", and that the Rosters/Bracket sections
  on `/events/[eventId]` stop rendering that player's name as a link on
  the next page load.
- Confirm `/players/[userId]` renders correctly for a signed-out visitor
  (no session at all), not just a signed-in one.
- Confirm a roster entry with no `user_id` (a pending invite, or a
  pre-migration free-text-only row) never renders as a link, regardless
  of any other player's sharing settings.
- On an event with completed bracket matches, confirm: an opted-in
  individual registrant's name is a link on the elimination `MatchCard`s,
  the standings table, and the round-robin match list (whichever apply
  to that event's bracket format); an opted-out or non-opted-in
  registrant's name in the same views stays plain text; a team-mode
  event's team names are never linked (no single team has one
  `user_id`).
- Click a linked name inside a `MatchCard` and confirm it navigates to
  the profile page rather than just toggling the card's expanded sets
  view.
- Confirm the existing admin bracket page
  (`/admin/locations/[locationId]/events/[eventId]/bracket`), which does
  not use `MatchCard`, is completely unaffected by Task 4's component
  change.
