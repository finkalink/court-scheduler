# Theme System, Phase 1: Tokens + Toggle — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-07

## Goal

Give the app a real design-token system (replacing the current two-variable
`--background`/`--foreground` in `globals.css`) with two named palettes —
"Sand and court teal" for light, "Charcoal and blue" for dark (amber
demoted to a secondary/status accent in dark mode) — plus a manual
light/dark toggle in the sidebar, with no flash-of-wrong-theme on load and
no page reload when toggled. This phase covers the token system, the
toggle, persistence, and re-theming `AppShell` itself (sidebar, nav, mobile
header) end to end. It does **not** yet touch the ~30 other files still
using ad-hoc `dark:` pairs or raw `bg-black`/`bg-white` — that's Phase 2,
a mechanical sweep once this foundation is proven.

Palette, as confirmed with the user via mockup:

| Token | Light (sand/teal) | Dark (charcoal/blue) |
|---|---|---|
| `--surface` (page bg) | `#F5F1E8` | `#15171C` |
| `--card` (raised surface) | `#FFFDF8` | `#1E2128` |
| `--active` (hover/active row) | `#EFE8D8` | `#262A32` |
| `--border` | `#E8DFC9` | `#2C3038` |
| `--fg` (primary text) | `#2B2418` | `#F2F3F5` |
| `--fg-muted` (secondary text) | `#7A6F58` | `#9AA0AC` |
| `--accent` (solid fill, buttons) | `#0F7A6B` (teal) | `#2B6FE0` (blue) |
| `--accent-hover` | `#0C6255` | `#3D7EF0` |
| `--accent-fg` (text on accent fill) | `#FFFFFF` | `#FFFFFF` |
| `--link` (accent used as text) | `#0F7A6B` | `#4E9BFF` (lighter, for legibility on charcoal) |
| `--status` (badge bg) | `#F5E4D0` | `#3D2E12` |
| `--status-fg` (badge text) | `#8A5322` | `#FFB25E` (amber) |

`--link` is deliberately a different value from `--accent` in dark mode —
a solid `#2B6FE0` reads fine as a button fill but is a bit flat as text
against `#15171C`; the lighter `#4E9BFF` keeps links legible without
changing the button color. (Same pattern behind most token systems'
separate "fill" vs "text" stops for a role — confirmed against reference
material read during design.)

## Non-goals

- **No repainting the rest of the app.** Every other component keeps its
  current `dark:`-paired Tailwind classes unchanged in this phase — they
  still work exactly as they do today (following system preference only),
  just not yet wired to the new tokens or the manual toggle. Phase 2's job.
- **No three-way "system/light/dark" selector.** A single binary switch,
  per the user's ask. Before the user's first click, the page still
  follows system preference exactly as it does today; the switch just
  displays the *current effective* state for reference. Clicking it makes
  an explicit, persisted choice from then on.
- **No server round-trip on toggle.** Instant client-side flip — `AppShell`
  is already a client component (`"use client"`, owns the mobile-drawer
  `open` state), so adding a small piece of client state here is not a
  new precedent for this codebase.

## Mechanism

**Storage:** a single cookie, `theme=light` or `theme=dark`, `path=/`,
`max-age` one year, `samesite=lax`. No `localStorage` — one source of
truth, readable both server-side (for the no-flash initial render) and
client-side (for the toggle to know current state), instead of two stores
that could drift.

**No flash of wrong theme:** `src/app/layout.tsx` is already a server
component (it calls `createClient()`/`getCurrentMembership` today) — it
reads the `theme` cookie via `next/headers`'s `cookies()` and sets
`data-theme="light"`/`"dark"` directly on the server-rendered `<html>`
tag. If no cookie exists yet (first-ever visit), the attribute is omitted
entirely and the existing `@media (prefers-color-scheme: dark)` CSS block
governs, exactly as today — so an unvisited browser sees correct colors
on the very first paint with zero client-side correction needed.

**CSS cascade** (`src/app/globals.css`), the same three-block shape this
project already uses for artifact dark-mode work, adapted for a real app:

```css
:root {
  /* light token values (bare defaults) */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* dark token values */
  }
}

:root[data-theme="dark"] {
  /* dark token values, again -- wins regardless of system preference */
}
```

An explicit `data-theme="light"` needs no third block: it just falls
through to the bare `:root` defaults, since light is this app's natural
default (not a dark-first design).

**Tailwind mapping:** every token also gets a `--color-*` alias in
`@theme inline`, so the rest of the app (Phase 2) can write plain
utilities — `bg-surface`, `bg-card`, `border-border`, `text-fg`,
`text-fg-muted`, `bg-accent`, `hover:bg-accent-hover`, `text-accent-fg`,
`text-link`, `bg-status`, `text-status-fg` — instead of hand-paired
`bg-white dark:bg-neutral-900` combinations.

**The toggle:** a new `ThemeToggle` client component, rendered in
`AppShell`'s sidebar footer (next to the sign-out/sign-in links, matching
where the confirmed mockup placed it). It receives the server-resolved
`initialTheme: "light" | "dark" | null` as a prop (`null` = following
system, no cookie yet) — passed down from `layout.tsx` through `AppShell`,
so the toggle's initial rendered state is always correct with no
client-only guessing and no hydration mismatch.

- If `initialTheme` is set, that's the toggle's starting position — trust
  it outright, it came from the same cookie the server already used to
  paint the page.
- If `initialTheme` is `null`, the toggle starts in a placeholder `"light"`
  state, then a `useEffect` (runs once, after mount) corrects it to match
  `window.matchMedia("(prefers-color-scheme: dark)").matches` — this only
  changes what the *switch looks like*, not the page's actual colors
  (still CSS-media-query-driven at this point) or the cookie (still
  unset) — merely viewing the page never pins a choice, only clicking does.
- On click: flips local state, sets `document.documentElement.dataset.theme`
  directly (instant repaint, no reload), and writes the `theme` cookie so
  the next server render picks it up too.

## File structure

```
src/lib/theme.ts                 -- NEW: Theme type, THEME_COOKIE_NAME, isValidTheme
src/lib/theme.test.ts            -- NEW: isValidTheme tests
src/components/ThemeToggle.tsx   -- NEW: the switch, client component
src/components/ThemeToggle.test.tsx -- NEW: RTL tests
src/app/globals.css              -- MODIFY: full token rewrite (light/dark/@theme)
src/app/layout.tsx               -- MODIFY: read cookie, set data-theme, pass initialTheme down
src/components/AppShell.tsx      -- MODIFY: render <ThemeToggle>, re-theme sidebar/nav/mobile header onto the new tokens
```

## `src/lib/theme.ts`

```ts
export type Theme = "light" | "dark";

export const THEME_COOKIE_NAME = "theme";

export function isValidTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark";
}
```

## `src/app/layout.tsx` changes

Add `import { cookies } from "next/headers";` and
`import { isValidTheme } from "@/lib/theme";`. Inside `RootLayout`:

```ts
const cookieStore = await cookies();
const themeCookie = cookieStore.get("theme")?.value;
const initialTheme = isValidTheme(themeCookie) ? themeCookie : null;
```

Then on the `<html>` tag: `data-theme={initialTheme ?? undefined}` (React
omits the attribute entirely when the value is `undefined`). Pass
`initialTheme` as a new prop into `<AppShell>`.

## `src/components/ThemeToggle.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, type Theme } from "@/lib/theme";

export default function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const [theme, setTheme] = useState<Theme>(initialTheme ?? "light");

  useEffect(() => {
    if (initialTheme) return; // server already resolved an explicit choice -- trust it
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }, [initialTheme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE_NAME}=${next}; max-age=31536000; path=/; samesite=lax`;
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Toggle dark mode"
      onClick={toggle}
      className="flex items-center gap-2 text-xs text-fg-muted"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${
          theme === "dark" ? "bg-accent" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            theme === "dark" ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
```

## `src/app/globals.css` (full replacement)

```css
@import "tailwindcss";

:root {
  --surface: #F5F1E8;
  --card: #FFFDF8;
  --active: #EFE8D8;
  --border: #E8DFC9;
  --fg: #2B2418;
  --fg-muted: #7A6F58;
  --accent: #0F7A6B;
  --accent-hover: #0C6255;
  --accent-fg: #FFFFFF;
  --link: #0F7A6B;
  --status: #F5E4D0;
  --status-fg: #8A5322;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #15171C;
    --card: #1E2128;
    --active: #262A32;
    --border: #2C3038;
    --fg: #F2F3F5;
    --fg-muted: #9AA0AC;
    --accent: #2B6FE0;
    --accent-hover: #3D7EF0;
    --accent-fg: #FFFFFF;
    --link: #4E9BFF;
    --status: #3D2E12;
    --status-fg: #FFB25E;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --surface: #15171C;
  --card: #1E2128;
  --active: #262A32;
  --border: #2C3038;
  --fg: #F2F3F5;
  --fg-muted: #9AA0AC;
  --accent: #2B6FE0;
  --accent-hover: #3D7EF0;
  --accent-fg: #FFFFFF;
  --link: #4E9BFF;
  --status: #3D2E12;
  --status-fg: #FFB25E;
  color-scheme: dark;
}

@theme inline {
  --color-surface: var(--surface);
  --color-card: var(--card);
  --color-active: var(--active);
  --color-border: var(--border);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-link: var(--link);
  --color-status: var(--status);
  --color-status-fg: var(--status-fg);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--surface);
  color: var(--fg);
}
```

## `src/components/AppShell.tsx` changes

- New prop: `initialTheme: Theme | null`, threaded into a new
  `<ThemeToggle initialTheme={initialTheme} />` rendered in the sidebar
  footer, above the existing sign-in/sign-out block.
- Re-theme onto the new tokens (this file only, in this phase):
  `bg-white dark:bg-neutral-900` → `bg-card`; `border-...dark:border-neutral-800`
  → `border-border`; `text-gray-900 dark:text-gray-100` → `text-fg`;
  `text-gray-700 dark:text-gray-300` / `text-gray-600 dark:text-gray-400`
  → `text-fg-muted`; the active-nav-row `bg-gray-100 dark:bg-neutral-800`
  → `bg-active`; hover states (`hover:bg-gray-50 dark:hover:bg-neutral-800`)
  → `hover:bg-active`. Links ("Sign In"/"Sign Up"/"Sign out") switch from
  plain `underline` to `text-link underline` so they pick up the accent
  color. No layout/structure changes — this is a class-level re-theme of
  an already-correct component.

## Testing plan

- `isValidTheme` — unit tested, test-first: `"light"` → true, `"dark"` →
  true, `"blue"` → false, `undefined` → false.
- `ThemeToggle` — RTL tests, test-first:
  - renders "Light" and `aria-checked="false"` when `initialTheme="light"`
  - renders "Dark" and `aria-checked="true"` when `initialTheme="dark"`
  - clicking flips the label, `aria-checked`, and sets
    `document.documentElement.dataset.theme` to the new value
  - clicking writes a `theme=` cookie with the new value (assert via
    `document.cookie`)
  - with `initialTheme={null}` and `window.matchMedia` mocked to report
    `matches: true` (dark), the component ends up showing "Dark" after
    the effect runs, with no cookie written (viewing alone doesn't persist
    a choice)
- No new tests for `layout.tsx`'s cookie-reading — consistent with this
  codebase's convention of verifying server components live rather than
  unit-testing them; covered by manual verification below instead.

## Manual verification plan

- Fresh browser profile (no cookie): confirm the page matches OS dark-mode
  setting on first load, and the toggle's displayed position matches it
  too, with no visible flash of the wrong theme.
- Click the toggle: confirm instant repaint (no page reload/navigation),
  correct new colors across the sidebar, and the label/switch position
  updates.
- Refresh the page after toggling: confirm the explicit choice persisted
  (server-rendered `data-theme` matches what was chosen, not system
  preference).
- With an explicit cookie set, change the OS-level dark/light setting:
  confirm the app does **not** follow it anymore (explicit choice wins).
- Resize to mobile width: confirm the toggle is reachable in the
  slide-over drawer and behaves identically to desktop.
- Confirm every other page in the app still renders correctly (unchanged
  in this phase, still following system preference via the existing
  `dark:` classes) — this phase must not break anything outside `AppShell`.
