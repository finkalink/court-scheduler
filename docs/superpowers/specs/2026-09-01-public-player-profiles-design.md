# Public-Facing Player Profiles — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-01

## Goal

Let a player opt in to sharing their win/loss record and games-played
tally on a public page, linked from wherever their name already appears
publicly (team rosters, bracket match cards, standings). Flagged as
follow-up work in the user-profiles spec
(`docs/superpowers/specs/2026-09-01-user-profiles-design.md`, "Future
work") now that `users.name`/`skill_level` exist to build it on top of.

Stats are computed live from data that already exists — every completed
`event_matches` row a player's registrations (individual or, for team
events, any team they've ever rostered on) have been part of, back to
whenever this app started recording results. No backfill needed; nothing
new to migrate historically, just a new lens on existing rows.

## Non-goals

- **No public directory.** No browsable/searchable list of players who've
  opted in — matches this app's established stance against building any
  browsable list of users (the same call made for team-roster search and
  email lookups). A profile is reachable only via a link from somewhere
  the player's name was already shown publicly, or by knowing the URL.
- **No granular per-field visibility.** One toggle: on shows name + skill
  level + the win/loss tally; off shows nothing. Gender stays private
  regardless of the toggle — not relevant to stats, more personal than
  the rest.
- **No match history or per-event breakdown.** Just the aggregate tally
  (wins, losses, games played) — not a list of which events or matches.
- **No leaderboard, ranking, or cross-player comparison.** One player's
  page shows only that player's numbers.
- **No change to the private `/profile` page's existing behavior** —
  name/gender/skill level stay exactly as private as they are today; this
  spec only adds one new opt-in field and one new public page that reads
  a strict subset of that data when the owner has opted in.

## Data model

```sql
alter table users add column share_stats_publicly boolean not null default false;
-- Off by default (opt-in, not opt-out). Editable via the existing
-- self-service "users update own" path -- the identity-column
-- protection trigger (0023_protect_users_identity_columns.sql) only
-- blocks email/role, so this stays freely self-editable like
-- name/gender/skill_level already are.

-- Returns a player's public stats ONLY if they've opted in -- an empty
-- result set is returned identically whether p_user_id doesn't exist OR
-- exists but hasn't opted in, so this can never be used to probe
-- account existence (same care already taken with
-- find_registered_user_by_email, 0021_team_roster_invites.sql). Granted
-- to anon as well as authenticated -- this page works for a signed-out
-- visitor, matching every other player-facing page in this app.
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

A player with zero completed matches gets a real `0-0, 0 games played`
row rather than nothing — the aggregate always returns exactly one row
regardless of how many (if any) matches match the filter.

**Known simplification:** roster membership is checked at read time, not
match time. A player added to a team's roster after some of that team's
matches were already played still gets credited for those earlier
matches too, since crediting is based on current `event_team_members`
membership, not who was on the roster when each specific match happened.
Consistent with the earlier "credit every roster member equally"
decision (this app has no per-match roster snapshot to check against
even if it wanted to), and not expected to matter in practice — a
mid-tournament roster change is already an edge case the brackets work's
withdraw/substitute mechanism handles by substituting the registration
itself, which does correctly exclude a withdrawn team's members from
whatever match they were substituted out of (see `event_matches`'
`team_a_registration_id`/`team_b_registration_id`, not `event_teams.id`,
being what a match actually references).

## Profile toggle & public page

`/profile` (`src/app/profile/page.tsx` / `updateProfile` in
`src/app/actions/profile.ts`) gains one checkbox, "Share my stats
publicly," saved alongside the existing name/gender/skill-level fields —
a plain boolean, no new validation beyond what the rest of that form
already does.

New page, `/players/[userId]` — public, works for a signed-out visitor
exactly like `/events/[eventId]` already does. Calls
`get_public_player_stats(userId)`; an empty result (not opted in, or no
such user — indistinguishable, by design) renders a generic "This
profile isn't available." rather than any more specific message.
Otherwise shows the player's name, skill level, and a `wins–losses` line
plus games played.

## Linking from rosters/brackets

Team rosters (the "Rosters" section from the team-roster-visibility work)
and the bracket views (match cards, standings tables, from the brackets
work) currently render a player's `display_name` as plain text. Both
already have the underlying `user_id` available on the rows they render
(`event_team_members.user_id`, `event_registrations.user_id`) wherever
it's set — pending invites and old free-text-only roster entries have no
`user_id` and stay plain text, unaffected.

For rows that do have a `user_id`, each of those two pages pre-checks
`share_stats_publicly` for that batch of user_ids in one query
(`select id from users where id = any($1) and share_stats_publicly =
true`) and renders the name as a link to `/players/[userId]` only for
the ones that come back true — everyone else still renders as plain
text, so a player never lands on a dead-end "not available" page from a
link that was shown to them as clickable.

## Testing plan

The win/loss aggregation lives entirely in SQL (`plpgsql`), which this
codebase doesn't unit-test — verified manually against the live database
instead, the same way every other RPC in this project has been
(`promote_next_waitlisted`, `claim_pending_team_invites`, etc.). No new
pure-logic TypeScript module — the only application-side logic is the
batch opt-in lookup on the two linking pages and the new page itself,
both server components/queries, neither unit-tested elsewhere in this
codebase either.

## Manual verification plan

- Apply the migration; confirm `get_public_player_stats` returns nothing
  for a real `user_id` who hasn't opted in, and nothing for a
  syntactically valid but nonexistent `user_id` — confirm both cases are
  indistinguishable from the caller's side.
- As a real test account with completed match history (from prior manual
  verification passes of the brackets work), opt in via `/profile`;
  confirm `/players/[that-user-id]` shows the correct name, skill level,
  and win/loss/games-played numbers, cross-checked by hand against the
  known match results.
- Confirm a player with an incomplete profile (missing name/gender/skill
  level) can still opt in and appears on their public page with whatever
  fields they do have set — the public-profile opt-in is independent of
  the separate "complete profile to register" gate from the user-profiles
  work.
- Confirm a team win/loss is correctly credited to every roster member,
  not just whoever the captain was, by checking two different team
  members' public pages after a team match completes.
- Confirm bye matches never appear in games-played, and a forfeit result
  does appear and counts correctly for both the winner and the player who
  forfeited.
- Toggle sharing off; confirm `/players/[userId]` immediately reverts to
  "This profile isn't available," and any links to it (rosters/brackets)
  stop rendering as links on the next page load.
- Confirm `/players/[userId]` renders correctly for a signed-out visitor
  (no session at all), not just a signed-in one.
- Confirm a roster/bracket entry with no `user_id` (a pending invite, or
  a pre-migration free-text-only roster row) never renders as a link,
  regardless of any other player's sharing settings.
