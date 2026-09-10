# Profile Photos & Social Links — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-09

## Goal

Close out the two smallest items left on the profile backlog
(`docs/STATUS.md`): an optional avatar photo, and optional Instagram /
Facebook / X handles, both set from `/profile`.

## Decisions (asked of the user up front)

- **Avatar visibility:** unconditional wherever a player's identity
  already renders to other players today — that's `/profile` (self),
  the public opt-in `/players/[userId]` page, and the Rosters section of
  an event's page (`src/app/events/[eventId]/page.tsx`, the
  `PlayerNameLink` list). It is **not** gated behind
  `share_stats_publicly` — a photo isn't the same kind of disclosure as a
  win/loss record, and rosters already show a player's chosen display
  name to anyone regardless of that opt-in.
- **Cropping:** client-side crop/zoom before upload, so every stored
  avatar is a consistent square regardless of the source photo's aspect
  ratio.
- **Social platforms:** Instagram, Facebook, X. No free-form "other"
  link for this pass.
- **Placeholder:** a generic silhouette/shadow icon when no photo is
  set — not initials, not a color block (this was already decided when
  the item was originally logged).

## Explicitly out of scope

- Bracket/standings tables and the admin "Registrants & Payments" list
  are dense grids, not a good fit for inline avatars without a layout
  redesign nobody's asked for — they stay text-only. Only the Rosters
  section (which already renders one row per player) gets an avatar.
- Social links render only on `/profile` (self-editable) and the public
  `/players/[userId]` page (gated by `share_stats_publicly`, same as the
  rest of that page) — not on rosters. Three extra icon links per roster
  row is clutter that wasn't asked for; the public player page is where
  "who is this person" questions actually get answered.
- No moderation/review of uploaded photos.
- No account-wide image reuse (banners, org logos, etc.) — this is a
  per-player avatar only.

## Data model

```sql
alter table users add column avatar_url text;
alter table users add column instagram_handle text;
alter table users add column facebook_handle text;
alter table users add column twitter_handle text;
```

No check constraints — a handle is free text (see "Handle parsing"
below), and `avatar_url` is only ever written by the app itself (a
Supabase Storage public URL), never accepted raw from the client.

No RLS change on `users` — all four columns are self-editable under the
existing `users update own` policy, and none of them are the kind of
privilege column `0023_protect_users_identity_columns.sql` exists to
pin.

**New Storage bucket, `avatars`** (public — the same tradeoff every
other "public-select" fact in this schema already makes: an avatar photo
needs to render on a roster to any visitor with no signed-URL
round-trip). RLS on `storage.objects`, scoped by path (`{user_id}/...`),
mirrors the DB-level ownership pattern this project already uses
elsewhere:

```sql
create policy "avatar select own"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar insert own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar update own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```

A public bucket serves *downloads* straight through Storage's public URL
without going through RLS at all -- but a select policy for `authenticated`
turned out to be necessary anyway, for a reason not obvious up front (see
"Found during manual verification" below): an authenticated *upsert*
internally requires a real, RLS-governed `select` to detect whether the
row already exists.

`get_public_player_stats` (`0024_public_player_profiles.sql`) gains
`avatar_url`, `instagram_handle`, `facebook_handle`, `twitter_handle` to
its returned row — a return-type change, so the migration drops and
recreates the function rather than `create or replace`.

## Handle parsing

Players will paste anything — a bare handle, an `@handle`, or a full
profile URL. One small pure function per platform normalizes to a bare
handle before storage, so `avatar_url`-style ambiguity (is this a link
or a name?) never reaches the database:

```ts
// src/lib/socialLinks.ts
parseSocialHandle(platform: "instagram" | "facebook" | "twitter", input: string): string
buildSocialUrl(platform: "instagram" | "facebook" | "twitter", handle: string): string
```

`parseSocialHandle` strips a leading `@`, and — if the input looks like
a URL for that platform (`instagram.com/`, `facebook.com/`,
`twitter.com/` or `x.com/`, with or without a scheme/`www.`) — strips
the domain and any trailing slash/query string too, leaving just the
handle. Anything else is trimmed and stored as-is (no character-set
validation — consistent with `name` and every other free-text profile
field). `buildSocialUrl` does the reverse for rendering: `instagram.com
/{handle}`, `facebook.com/{handle}`, `x.com/{handle}` (X's own current
domain, not `twitter.com`, since that's what a fresh link should point
at regardless of which domain the player pasted).

Built test-first: empty input, bare handle, `@handle`, and one full-URL
variant per platform (with and without `https://www.`).

## Avatar upload flow

New client component, `AvatarUploader` (`src/components/AvatarUploader.tsx`):

1. A file `<input>` (accept `image/*`) opens the OS picker. Rejects
   anything over 8 MB or not an image before ever touching the canvas
   (a friendly inline message, no upload attempt).
2. The selected image renders inside a fixed circular crop viewport.
   Drag to reposition, a zoom slider (range input, no library) to scale
   — hand-rolled with pointer events and a clamped translate/scale pair,
   the same "don't add a dependency for what a small function covers"
   call this codebase already made for `.ics` generation
   (`buildIcsContent`, `src/lib/calendarLinks.ts`). No new npm
   dependency.
3. "Save photo" draws the current viewport onto an offscreen
   `<canvas>` at a fixed 400×400 output and exports it as a JPEG blob
   (quality 0.85) — every stored avatar is the same size/format
   regardless of source.
4. The blob is POSTed (plain `fetch`, not a Server Action — Server
   Actions don't accept a `Blob`/`File` body the way a route handler
   does) to a new `POST /api/profile/avatar` route.
5. On success, the component calls `router.refresh()` so the
   server-rendered `/profile` page picks up the new `avatar_url`
   immediately; no client-side state duplicates what the server already
   knows.

A "Remove photo" button (shown only when an avatar is already set)
calls `DELETE /api/profile/avatar` the same way.

### `src/app/api/profile/avatar/route.ts`

- **POST:** authenticates via the existing server Supabase client
  (`createClient()`, cookie-based — same as every other route in this
  app); 401s with no session. Uploads the blob to
  `avatars/{user.id}/avatar.jpg` with `upsert: true` (one fixed path per
  user — a new photo replaces the old one, no orphaned files to clean
  up). Builds the public URL via
  `supabase.storage.from("avatars").getPublicUrl(...)` and appends
  `?v={Date.now()}` before saving it to `users.avatar_url` — plain
  browser/CDN caching would otherwise keep showing the old image at the
  same URL after a re-upload. Returns `{ avatarUrl }`.
- **DELETE:** authenticates the same way, removes the stored object
  (`storage.from("avatars").remove(...)`, best-effort — a missing object
  isn't an error condition worth surfacing) and sets `avatar_url` to
  `null`.

No new columns needed to track "has an avatar" — `avatar_url` being
non-null already means one exists.

## Rendering

New shared `Avatar` component (`src/components/Avatar.tsx`) — takes
`url: string | null` and a `size` (`sm` for rosters, `md`/`lg` for
profile pages), renders either an `<img>` or a small hand-drawn
silhouette `<svg>` (no icon library, matching this codebase's existing
convention). Used in three places:

- `/profile` — the uploader's live preview, `lg`.
- `/players/[userId]` — `md`, next to the player's name; social links
  (when set) render as plain text links below the stats
  (`Instagram`/`Facebook`/`X`, each `buildSocialUrl`'d), matching this
  page's existing plain, unstyled layout — no brand icon glyphs.
- Rosters section, `src/app/events/[eventId]/page.tsx` — `sm`, to the
  left of each `PlayerNameLink`. Needs each member's `avatar_url`
  regardless of `share_stats_publicly`, which the existing per-user
  `users` RLS (`select own`) blocks for anyone but the row's own owner —
  the same shape of gap this codebase has already hit and fixed several
  times (`find_registered_user_by_email`, `filter_public_profile_user_ids`,
  `is_profile_complete_for_user`). Fixed the same way: a new narrow
  `security definer` RPC,

  ```sql
  create function public.get_avatar_urls(p_user_ids uuid[])
  returns table(user_id uuid, avatar_url text)
  ```

  returning only `id`/`avatar_url` pairs for the requested ids — no
  opt-in gate, since an avatar was scoped above as unconditional, and no
  other column exposed. `sharingUserIds`'s existing
  `filter_public_profile_user_ids` call in that same file is the
  template to follow for wiring this one in alongside it.

## Testing plan

- `parseSocialHandle`/`buildSocialUrl` — unit-tested test-first, per
  platform: empty input, bare handle, `@handle`, full URL with and
  without `https://www.`.
- No new tests for `AvatarUploader`, the API route, or the page/RPC
  wiring — consistent with this codebase's existing convention of
  verifying server actions/routes and page components live rather than
  unit-testing them (the crop math in particular is easiest to actually
  trust by dragging a real image around in the browser).

## Manual verification plan

- Apply the migration; confirm the `avatars` bucket exists and is
  public, and that an authenticated user can upload only under their own
  `{user_id}/` path (a raw attempt at another user's path should be
  rejected by RLS).
- From `/profile`: upload a photo, drag/zoom the crop, save — confirm
  it renders immediately (post-refresh) and persists across a full page
  reload. Re-upload a second photo and confirm the old one is actually
  replaced (not just visually — check the stored object), not left
  orphaned in Storage. Remove the photo and confirm the placeholder
  silhouette returns everywhere the avatar was showing.
- Enter each social handle in all three input styles (bare, `@handle`,
  full URL) and confirm what's actually stored is the bare handle in
  each case; confirm the built links on `/players/[userId]` point to
  the right profile.
- As a different, second account, view a roster containing the first
  account's avatar — confirm the photo shows even when that player has
  `share_stats_publicly` off (the unconditional-visibility decision),
  and confirm their social links do *not* leak onto the roster.
- Visit `/players/[userId]` signed out entirely (or as a third account)
  for a player who has opted into `share_stats_publicly` — confirm photo
  and social links render there; confirm they don't render at all for a
  player who hasn't opted in (the page already returns nothing for
  those, unchanged).

## Found during manual verification

The upload route initially failed every real attempt with a generic
Storage error, `new row violates row-level security policy`, even
though the `insert`/`update`/`delete` policies above looked correct and
the request carried a genuinely valid session JWT (confirmed by
reproducing the exact request `storage-js` sends — including its
`x-upsert` header — directly against the Storage API outside the SDK
entirely, isolating the client from the server). Bisecting header-by-
header on that raw request showed `x-upsert: true` alone was enough to
turn an otherwise-successful upload into this failure. Root cause:
Storage's own upsert handling does a real, RLS-governed `select` against
`storage.objects` first, to decide whether the object already exists —
and with no `select` policy for `authenticated`, that internal check is
denied, which surfaces as a generic RLS error on the whole request
rather than anything that names `select` specifically. A first-time
upload with `upsert: false` would never hit this; every upload here uses
`upsert: true` on a fixed per-user path, so it hit it every time. Fixed
by adding the `avatar select own` policy above, scoped identically to
the write policies — it exposes nothing an unauthenticated download of
the same public object wouldn't already. A dead-end pursued before
finding this: `@supabase/ssr`'s server client was suspected of not
propagating the session's JWT into `.storage` calls at all (its
Storage sub-client's headers are captured once at construction, and its
shared dynamic-auth `fetch` wrapper only fills in `Authorization` when
a request doesn't already carry one) — plausible-sounding, and it
produced a matching symptom, but a control test using a plain SDK client
authenticated via `signInWithPassword` (no `@supabase/ssr` involved at
all) failed identically, which is what actually pointed at the real,
policy-level cause instead.
