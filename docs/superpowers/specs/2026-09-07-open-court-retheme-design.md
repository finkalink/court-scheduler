# Open Court Re-theme & Navigation — Design Spec

Status: draft — pending user review
Date: 2026-09-07

## Goal

Replace the "sand and court teal" palette shipped in
[Theme System, Phase 1](2026-09-07-theme-system-phase1-design.md) with the
"Open Court" palette and type system (confirmed via mockup: blue/orange on
a light-neutral ground, Barlow Condensed + Barlow), restructure `AppShell`
from a sidebar into a top-nav layout, and finish the token sweep that
Phase 1 explicitly deferred — the ~30 remaining files still pairing raw
`dark:` Tailwind classes instead of the semantic tokens. This spec
supersedes Phase 1's placeholder "Phase 2 is a mechanical sweep, same
palette" framing: the sweep now happens *during* a palette and navigation
change, not after, since shipping the new palette without it would leave
those ~30 files visibly inconsistent (wrong colors in dark mode, no accent
carryover).

Palette, typography, and the badge/nav/card treatment were confirmed
against two Claude artifacts reviewed with the user during design (not
repo files): the "Open Court" landing mockup and the "Open Court Tokens"
light/dark reference page. `--accent` moves from teal to orange; the old
teal survives as a distinct `--success` role rather than disappearing,
since `SuccessBanner.tsx` needs a semantic success color independent of
the brand accent.

| Token | Light | Dark |
|---|---|---|
| `--surface` (page bg) | `#F8FAFC` | `#0B1220` |
| `--card` (raised surface) | `#FFFFFF` | `#121A2B` |
| `--active` (hover/active row) | `#EFF4FB` | `#17233A` |
| `--border` | `#E2E8F0` | `#223049` |
| `--fg` (primary text) | `#1E293B` | `#E7ECF6` |
| `--fg-muted` (secondary text) | `#55647A` | `#93A2BD` |
| `--accent` (solid fill, buttons, focus) | `#F97316` | `#FB923C` |
| `--accent-hover` | `#EA6A0C` | `#FDBA74` |
| `--accent-fg` (text on accent fill) | `#1E1006` | `#1E1006` |
| `--link` (accent used as text) | `#3B82F6` | `#7CB2FB` |
| `--status` (badge bg) | `#FEF3E8` | `#2A1B0C` |
| `--status-fg` (badge text) | `#C2540A` | `#FDBA74` |
| `--success` (solid fill/icons) | `#0F7A6B` | `#2DD4BF` |
| `--success-bg` (banner tint) | `#E6F5F2` | `#10302B` |
| `--success-fg` (text on tint) | `#0B5D51` | `#5EEAD4` |

`--link` is a distinct hue from `--accent` (blue vs. orange), same pattern
Phase 1 used for a different reason: here it's so the app doesn't read as
one-note orange everywhere text happens to be a link — the single sharp
accent stays reserved for buttons, focus rings, and status highlights, per
`docs/design.md`'s color-ratio rule. `--success`/`--success-bg`/`--success-fg`
follow the same three-token shape as `--status`/`--status-fg`, adding a
`-bg` tint variant because `SuccessBanner` needs a full banner background,
not just badge text.

**Typography:** `next/font/google` swaps `Geist`/`Geist_Mono` for
`Barlow_Condensed` and `Barlow`, mapped to `--font-display` and
`--font-sans` respectively. Barlow Condensed applies only via a new
`font-display` utility, used for page headings (`h1`/`h2`), the nav
wordmark, and section titles — never body copy, buttons, or form labels,
which stay on Barlow for legibility in dense screens (per
`docs/design.md`, sections 1 and 3's own carve-out against the marketing
treatment on functional UI).

## Non-goals

- **No asymmetric/bento layouts inside the dashboard.** The hero/bento
  treatment from the Open Court mockup applies to a future public
  marketing homepage only (out of scope for this spec — `src/app/page.tsx`
  today is the "Find a Court" search screen, not a marketing page, and
  stays a functional listing screen here). This phase is tokens,
  typography, and navigation structure — not asymmetric composition.
- **No new theme selector UI.** `ThemeToggle` keeps its existing
  light/dark binary mechanism from Phase 1 unchanged; only the token
  values it flips between change.
- **No changes to `src/lib/theme.ts`, the cookie mechanism, or
  `layout.tsx`'s server-side no-flash logic.** All proven in Phase 1;
  reused as-is.
- **No new admin functionality.** The admin sub-nav reorganizes existing
  links (Locations, Team, Events) — it does not add or remove any admin
  capability.

## Navigation restructure

`AppShell`'s sidebar (fixed-left, hamburger-triggered on mobile) becomes a
sticky top nav:

```
[ Wordmark ]   Find a Court   Events   My Bookings   Profile        [ Sign in / user menu ]
```

- Desktop: single horizontal bar, links inline, sticky to viewport top
  (matches the Open Court mockup's `.nav`).
- Mobile (< 640px): links collapse behind a hamburger button that opens a
  full-width dropdown panel below the bar (not a slide-over drawer like
  today — simpler, and the top-nav has no sidebar width to slide from).
  The dropdown contains the same links `AppShell` renders today, in the
  same order, plus sign-in/out at the bottom.
- **Admin sub-nav:** when `pathname` starts with `/admin`, a second, thinner
  tab bar renders directly below the main nav: `Locations | Team | Events`.
  This replaces the sidebar's indented admin section. Non-admin routes
  never render this second bar.
- `ThemeToggle` moves from the sidebar footer into a small new account
  menu (a lightweight dropdown anchored to the sign-in/user-email area on
  desktop — there is no existing "user menu" component today, so this is
  new, minimal UI: just the email/sign-out block and the toggle, not a
  general-purpose account settings surface). On mobile it renders inline
  inside the hamburger dropdown instead, in the same relative position it
  occupies today.

## File structure

```
src/app/layout.tsx               -- MODIFY: swap Geist/Geist_Mono for Barlow/Barlow_Condensed
src/app/globals.css              -- MODIFY: full token rewrite (palette above), add font-display utility
src/components/AppShell.tsx      -- MODIFY: sidebar -> top nav + mobile dropdown + admin sub-nav
src/components/AppShell.test.tsx -- MODIFY/NEW: cover the new nav structure (see Testing plan)
src/components/SuccessBanner.tsx -- MODIFY: bg-green-.../dark:bg-green-... -> bg-success-bg/text-success-fg
```

Plus the ~30-file token sweep (raw `dark:` pairs → semantic token classes),
in batches:

1. **Shared components** — `AddressLookup`, `SuccessBanner`, `SkillLevelPicker`,
   `TimezoneSelect`, `AllCitiesContent`, `CityContent`, bracket components
   (`InteractiveBracket`, `MatchCardGrid`, `MatchResultSheet`).
2. **Player-facing pages** — `login`, `signup`, `profile`, `bookings`,
   `bookings/[bookingId]`, `events`, `events/[eventId]`,
   `events/registrations`, `choose-city`, `locations/[locationId]` and its
   `courts/[courtId]` and `courts/[courtId]/book` subpages,
   `players/[userId]`, `clubs/[orgId]`.
3. **Admin pages** — `admin`, `admin/team`, `admin/locations/[locationId]`
   and its `courts/[courtId]`, `events`, `events/[eventId]`,
   `events/[eventId]/bracket` subpages.

Each batch is its own commit/PR. Exact per-file class mappings follow
Phase 1's `AppShell` precedent (`bg-white dark:bg-neutral-900` → `bg-card`,
`text-gray-900 dark:text-gray-100` → `text-fg`, etc.) — the implementation
plan enumerates the specific mapping table once, and every file in every
batch applies it mechanically rather than inventing new roles per file.

## Testing plan

- `SuccessBanner` — existing tests (if any) updated to assert the new
  `bg-success-bg`/`text-success-fg` classes instead of the old green
  Tailwind pairs.
- `AppShell` — RTL tests, test-first, covering the new structure:
  - renders the top nav with all expected links when `userEmail` is set
    vs. `null` (mirrors today's conditional-link coverage)
  - admin sub-nav renders only when `isOrgMember` is true and `pathname`
    starts with `/admin`; absent otherwise
  - mobile hamburger button toggles the dropdown panel open/closed
  - `ThemeToggle` renders inside the user menu / mobile dropdown, not a
    sidebar footer
- Each swept file: run its existing test suite (if any) after reclassing;
  no new test cases needed purely for a class-name swap, since none of
  these are behavior changes — but any file with zero existing coverage
  that this touches gets a smoke-level RTL render test added (renders
  without throwing, key text visible), consistent with "don't extract
  logic just to test it" but not leaving a touched file with zero
  regression coverage either.
- `npm test` after each batch, not just at the end.

## Manual verification plan

- Compare the running app against the "Open Court Tokens" preview and the
  "Open Court" mockup artifacts in both light and dark mode.
- Click through every top-nav link and the admin sub-nav on desktop width;
  confirm active-state styling matches the current sidebar's active-row
  treatment (now `bg-active` under the new tokens).
- Resize to mobile width (375px per `docs/design.md`'s responsive
  checkpoints): confirm the hamburger dropdown opens/closes, contains all
  links plus the theme toggle, and nothing is hidden behind the sticky nav.
- Toggle dark mode from the new user-menu location; confirm no regressions
  from Phase 1's no-flash/persistence behavior.
- Spot-check each swept batch's pages in both themes before moving to the
  next batch — catches a wrong mapping early instead of after 30 files.
- Confirm `SuccessBanner` (used on the booking-confirmation flow) reads
  correctly in both themes with the new success tokens.
