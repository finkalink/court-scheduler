# Profile Photos & Social Links Implementation Plan

**Goal:** Add an optional avatar photo (client-cropped, unconditionally
visible on rosters/public profile) and optional Instagram/Facebook/X
handles to `/profile`.

**Spec:** `docs/superpowers/specs/2026-09-09-profile-photos-social-links-design.md`

**Note:** implemented directly in this session, task-by-task, no
subagent dispatch (matches how the design-consistency pass was handled
when the `superpowers` plugin was off — same call here, small enough
scope not to need it).

## Tasks

1. **Migration `0041_profile_photos_social_links.sql`** — `users`
   columns (`avatar_url`, `instagram_handle`, `facebook_handle`,
   `twitter_handle`), `avatars` Storage bucket (public) + own-path RLS
   on `storage.objects`, new `get_avatar_urls(uuid[])` RPC, and
   `get_public_player_stats` dropped/recreated with the four new
   columns. Apply via `npm run migrate`.

2. **`src/lib/socialLinks.ts` + test** — `parseSocialHandle`/
   `buildSocialUrl`, test-first.

3. **`src/components/Avatar.tsx`** — shared `<img>`-or-silhouette
   component, `sm`/`md`/`lg` sizes.

4. **`src/app/api/profile/avatar/route.ts`** — `POST` (upload + persist
   `avatar_url`) / `DELETE` (remove + clear).

5. **`src/components/AvatarUploader.tsx`** — file picker, hand-rolled
   drag/zoom crop, canvas export, posts to the route above, `Remove
   photo` button.

6. **`/profile` wiring** — render `AvatarUploader`; extend the page's
   `users` select and `updateProfile` (`src/app/actions/profile.ts`) to
   read/save the three handle fields via `parseSocialHandle`.

7. **`/players/[userId]`** — render `Avatar` + built social links from
   the RPC's new columns.

8. **Rosters wiring** — `src/app/events/[eventId]/page.tsx` calls
   `get_avatar_urls` alongside the existing `filter_public_profile_user_ids`
   call, renders `Avatar` (`sm`) to the left of each `PlayerNameLink`.

9. **Manual verification** per the spec's plan — dev server, real
   login, two test accounts (own-path RLS, unconditional roster
   visibility, remove/replace, handle parsing variants).

`npm test` + `tsc --noEmit` clean before calling this done.
