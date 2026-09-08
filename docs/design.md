# Design Rules

Foundational aesthetic rules for any UI work on court-scheduler. These apply on top of whatever component library or Tailwind setup is in use — they constrain *how* things look, not which tools build them. Violating one of these on a design task is a bug, not a style preference.

## 1. Typography — no generic system fonts

- Never ship `font-family: system-ui`, `-apple-system`, `Arial`, `Helvetica`, or the Tailwind default sans stack as the visible typeface. These read as "unstyled."
- Every screen pairs exactly two typefaces:
  - **Display font** — headings, hero text, nav wordmark, anything meant to carry personality. Pick something with real character (a serif with contrast, a grotesque with distinctive letterforms, a slab) — not another neutral grotesque. (A condensed cut of the body font's own family — e.g. Barlow Condensed alongside Barlow — is an acceptable exception to "not another neutral grotesque": the compression itself reads as characterful, particularly for an athletic/sports register, even though it's the same type family underneath. This isn't a license to reach for any weight/width variant of the body font and call it a display font — the condensed-cut case specifically is what's exempted.)
  - **Body font** — paragraphs, form labels, table data, buttons. Optimized for legibility at small sizes, quiet, gets out of the way.
- Load both as real font files (Google Fonts via `next/font/google`, or self-hosted) — never rely on the OS default resolving to something reasonable.
- Wire the pair into Tailwind as named tokens, not ad hoc classes:
  ```css
  @theme {
    --font-display: "Fraunces", "Georgia", serif;
    --font-sans: "Inter", "Helvetica Neue", sans-serif;
  }
  ```
  Use `font-display` / `font-sans` utility classes everywhere — a component reaching for a raw font name instead of the token is a sign the pairing isn't actually wired up. (Named `--font-sans`/`font-sans` for the body role, matching Tailwind's own built-in token name and this codebase's actual `globals.css` — not `--font-body`/`font-body`.)
- Fallback stacks are required (real fonts fail to load on flaky connections) but the fallback should never be what most users see.

## 2. Color ratio — dominant tone + one sharp accent

- Do not split a palette evenly across 3–5 "brand colors." Evenly-weighted palettes read as generic and indecisive.
- Structure every screen as: one **dominant background/surface tone** (roughly 80–90% of visual weight — this can be a near-white, a near-black, or a muted tint, not necessarily literal white) plus **one accent color** used sparingly and consistently for the things that must draw the eye: primary CTA, active/selected state, focus rings, links, key data points. Nothing else gets the accent.
- The accent should be genuinely high-contrast against the dominant tone — not a slightly-more-saturated version of it. If the dominant tone is warm and neutral, the accent can be a saturated hue from across the color wheel; if it's already a strong color, the accent is what pops off it.
- Everything is a CSS variable, defined once, never a hardcoded hex in a component:
  ```css
  :root {
    --color-surface: oklch(0.98 0.01 90);   /* dominant */
    --color-ink: oklch(0.20 0.02 90);       /* text on surface */
    --color-accent: oklch(0.62 0.24 25);    /* the one sharp accent */
  }
  ```
- Check accent-on-surface contrast against WCAG AA before calling a palette done. A "premium" palette that fails contrast is still a bug.
- Status colors (success/warning/error) are the one exception to "one accent" — they're semantic, not decorative, and stay visually distinct from the brand accent.

## 3. Spatial composition — break the grid on purpose

- Default to asymmetry, not centered/evenly-spaced layouts. A perfectly symmetric, evenly-padded grid is the fallback when no one made a layout decision.
- Concretely, reach for:
  - Uneven column splits (e.g., 65/35 or 70/30) instead of 50/50 or a uniform 12-col grid used the same way every section.
  - Generous, uneven negative space — let one side of a section breathe while the other is denser. Don't pad every block identically "for consistency."
  - Elements that overlap or bleed across a section boundary (a card that overlaps the section below it, an image that ignores its container's padding) rather than everything sitting obediently inside its box.
  - Varied vertical rhythm between sections instead of the same `py-16` on every single one.
- This is a per-section decision, not a global CSS reset — dense UI (booking calendars, admin tables, forms) still needs a legible, mostly-regular grid to function. Reserve the asymmetry for marketing/landing surfaces and section-level composition, not for the court-availability grid itself.

## 4. Polish — subtle texture, not flat/default

- Scope: this rule targets marketing/landing surfaces (heroes, section backgrounds on public-facing pages), not the functional dashboard — the booking grid, admin tables, and forms stay flat/token-driven per §3's dense-UI carve-out; don't read this as a mandate to add grain overlays or glass panels to working UI.
- Flat single-color surfaces with no texture read as a wireframe, not a finished product. Add restrained texture to large surface areas (heroes, section backgrounds, cards):
  - **Noise overlays** — a low-opacity grain layer over a flat color/gradient to kill banding and add tactility.
  - **Gradient meshes** — soft, multi-stop gradients (not a single linear two-color fade) behind hero/marketing content.
  - **Layered transparency** — translucent panels over a background (glass-morphism-style `backdrop-filter: blur()` cards), used to create depth between foreground content and the background layer.
- Before inventing a texture ad hoc, check the installed `design-system` and `ui-styling` skills' reference data (`~/.claude/skills/design-system/data/*.csv`, `references/tailwind-integration.md`) for existing gradient/overlay/background conventions and reuse those patterns instead of freehanding new ones each time.
- Texture is in service of the content: it must never reduce text contrast below WCAG AA, and it should be near-invisible until you look for it. If a reviewer's first reaction is "why is the background so busy," it's overdone — pull it back.
