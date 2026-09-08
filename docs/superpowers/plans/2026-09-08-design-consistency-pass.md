# Design Consistency Pass Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Each task is a self-contained commit with its own tests where applicable. Run `npm test` after each task.

**Goal:** Finish applying the semantic token system (introduced for the homepage and nav shell) to the rest of the app — 30 files, ~257 occurrences of hardcoded Tailwind colors (`bg-black`, `text-gray-*`, `bg-gray-*`, `border-gray-*`, `bg-blue-*`, `text-blue-*`, `bg-red-*`, `text-red-*`, `dark:*-neutral-*`) — plus fix the booking-flow CTA color bug, unify event-type badge styling, and settle a link-vs-button convention.

**Architecture:** No new subsystems. Two small shared primitives (`EventTypeBadge`, a button-style helper) get introduced first so later tasks consume them instead of hand-rolling styles. Every other task is a mechanical sweep of one area of the app onto the existing tokens defined in `src/app/globals.css`. Two new CSS tokens (`--error`/`--error-bg`/`--error-fg`) are added, mirroring the existing `--success`/`--success-bg`/`--success-fg` pattern exactly, because ~20 error banners across the app have no token to move to otherwise.

**Tech Stack:** Next.js App Router, Tailwind CSS v4 semantic tokens (`src/app/globals.css`), Vitest + React Testing Library.

**Spec:** No separate spec doc — this plan implements the design-consistency findings from an in-chat design critique (theme/browsing/usability/flow/design review of the live app), approved by the human partner in chat on 2026-09-08. Scope: consistency pass only (not the discretionary polish items — branded 404, per-page titles, richer desktop layout, decorative touches — which are explicitly deferred).

## Global Constraints

- No new dependencies.
- No new colors invented beyond the two additive tokens below — every other replacement reuses an existing token from `src/app/globals.css`.
- Convention going forward: **pure navigation** (a "← back" link, a club/location name, an external map link) stays a plain text link styled `text-link underline`. Anything that **submits a form, commits an action, or changes state** (sign in, sign up, continue, register, cancel, save, toggle) uses the new button-style helper — either `primary` (accent) or `secondary` (bordered/neutral). A destructive-but-secondary action (cancel a booking, remove a team member) keeps its existing "small underlined text" placement in a list row, just recolored onto `--error-fg` rather than turned into a full button — don't upgrade these to buttons, that's out of scope and would touch layout, not just color.
- Every task's diff should be colors/classes only — no behavior change, no prop/interface change, unless the task explicitly says so (only Task 1 and Task 2 touch component structure).
- Run `npm test` and `npx tsc --noEmit` after every task; both must stay clean.
- This is a mobile-first app: keep every existing responsive class (`sm:`, breakpoints) exactly as-is — only the color/border utility classes change.

## Token Reference (add to `src/app/globals.css`, Task 1)

Add these three variables to the `:root` block, the `@media (prefers-color-scheme: dark)` block, and the `:root[data-theme="dark"]` block, following the exact existing pattern of `--success`/`--success-bg`/`--success-fg`, and register them in the `@theme inline` block as `--color-error`, `--color-error-bg`, `--color-error-fg`:

| Token | Light value | Dark value |
|---|---|---|
| `--error` | `#DC2626` | `#F87171` |
| `--error-bg` | `#FDECEC` | `#2A1414` |
| `--error-fg` | `#B91C1C` | `#FCA5A5` |

## Class Replacement Map (apply throughout)

| Legacy class(es) | Replacement |
|---|---|
| `bg-black` + `text-white` (primary button/link) | new `buttonClass("primary")` — see Task 1 |
| `bg-gray-200 text-gray-500 cursor-not-allowed` (disabled button) | new `buttonClass("primary", { disabled: true })` — see Task 1 |
| `text-gray-600`, `text-gray-500`, `text-neutral-500` | `text-fg-muted` |
| `dark:text-neutral-400`, `dark:text-neutral-100` (paired with a light-mode class above) | delete — drop the `dark:` override entirely, the token already covers both themes |
| `border-gray-300`, `border-gray-400`, `border` (bare, no color) | `border-border` |
| `dark:border-neutral-800`, `dark:border-neutral-700`, `dark:border-neutral-600` | delete — drop the `dark:` override |
| `hover:bg-gray-50`, `hover:bg-gray-100` + `dark:hover:bg-neutral-800` | `hover:bg-active` (single class, replaces both) |
| `dark:bg-neutral-800`, `dark:bg-neutral-900` (input/select backgrounds) | `bg-card` |
| `bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300` (info banner) | `bg-active text-fg` |
| `bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300` (error banner) | `bg-error-bg text-error-fg` |
| `text-red-700`, `text-red-800` (bare, no bg — destructive text link) | `text-error-fg` |
| `dark:text-red-400`, `dark:text-red-300` (paired with a red class above) | delete — drop the `dark:` override |
| `border-red-400`, `border-red-300` + `dark:border-red-800`/`dark:border-red-900` | `border-error-fg` (delete the `dark:` override) |
| `text-blue-700 dark:text-blue-400` (selected-item highlight, not a link) | `text-accent` |
| `bg-gray-100 dark:bg-neutral-800` (hover/highlighted row, not a link) | `bg-active` |
| `bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300` (confirmed/paid/saved banner or badge) | `bg-success-bg text-success-fg` |
| `text-green-700`/`text-green-800` (bare, no bg — a small "Saved."/"Paid ✓" confirmation) | `text-success-fg` |
| `dark:text-green-300`/`dark:text-green-400` (paired with a green class above) | delete — drop the `dark:` override |
| `bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300` (pending/waitlisted/incomplete-profile banner or badge) | `bg-status text-status-fg` |
| `border-yellow-300 dark:border-yellow-900` (bordered warning box) | `border-status-fg` — if `border-status-fg` renders too strong against `bg-status`, use `border-border` instead; use judgment, this is a soft warning box not an alert |
| `text-yellow-800` (bare, no bg — an underlined "waitlisted" link) | `text-status-fg` |
| `dark:text-yellow-300`/`dark:text-yellow-400` (paired with a yellow class above) | delete — drop the `dark:` override |

**Note on scope:** yellow/green usage was found *after* Task 3 was already implemented and reviewed (ruling recorded in the ledger) — it is NOT part of Tasks 3-8's per-task scope even in files those tasks otherwise cover. It is handled entirely by Task 9 below, in one dedicated pass, so no earlier task's file list should be reopened for this.

Anywhere a class isn't in this table, match it to the nearest token by what it's doing (muted secondary text → `text-fg-muted`, a card/row border → `border-border`, a hover surface → `hover:bg-active`) rather than guessing a new one.

## Task 1: Shared primitives — EventTypeBadge, button styles, error tokens

**Files:**
- Create: `src/components/EventTypeBadge.tsx`
- Create: `src/components/EventTypeBadge.test.tsx`
- Create: `src/lib/buttonStyles.ts`
- Create: `src/lib/buttonStyles.test.ts`
- Modify: `src/app/globals.css` (add `--error`/`--error-bg`/`--error-fg`, per the Token Reference table above)

**Interfaces:**
- Produces: `EventTypeBadge({ eventType }: { eventType: string })` → renders `<span>` with the pill classes below and the label from `EVENT_TYPE_LABELS[eventType]`.
- Produces: `buttonClass(variant: "primary" | "secondary", opts?: { disabled?: boolean }): string` — a plain function returning a class string (no JSX component, so it drops into an existing `<button>`/`<Link>`/`<a>` without changing element type).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/EventTypeBadge.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EventTypeBadge from "./EventTypeBadge";

describe("EventTypeBadge", () => {
  it("renders the human-readable label for the event type", () => {
    render(<EventTypeBadge eventType="open_play" />);
    expect(screen.getByText("Open Play")).toBeInTheDocument();
  });

  it("applies the status pill styling", () => {
    render(<EventTypeBadge eventType="tournament" />);
    const badge = screen.getByText("Tournament");
    expect(badge.className).toContain("bg-status");
    expect(badge.className).toContain("text-status-fg");
    expect(badge.className).toContain("rounded-full");
  });
});
```

```ts
// src/lib/buttonStyles.test.ts
import { describe, expect, it } from "vitest";
import { buttonClass } from "./buttonStyles";

describe("buttonClass", () => {
  it("returns accent styling for the primary variant", () => {
    const cls = buttonClass("primary");
    expect(cls).toContain("bg-accent");
    expect(cls).toContain("text-accent-fg");
  });

  it("returns bordered neutral styling for the secondary variant", () => {
    const cls = buttonClass("secondary");
    expect(cls).toContain("border-border");
    expect(cls).not.toContain("bg-accent");
  });

  it("returns a disabled, non-interactive style for either variant when disabled", () => {
    const cls = buttonClass("primary", { disabled: true });
    expect(cls).toContain("cursor-not-allowed");
    expect(cls).toContain("bg-active");
    expect(cls).not.toContain("bg-accent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- EventTypeBadge buttonStyles`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement**

```tsx
// src/components/EventTypeBadge.tsx
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default function EventTypeBadge({ eventType }: { eventType: string }) {
  return (
    <span className="inline-block rounded-full bg-status px-3 py-0.5 text-xs font-medium text-status-fg">
      {EVENT_TYPE_LABELS[eventType] ?? eventType}
    </span>
  );
}
```

```ts
// src/lib/buttonStyles.ts
// Shared button styling: `primary` (bg-accent) is for anything that submits,
// commits, or changes state; `secondary` is a bordered neutral style for
// less prominent actions in the same category. Plain navigation should stay
// a text link (`text-link underline`), not this helper.
type Variant = "primary" | "secondary";

export function buttonClass(variant: Variant, opts?: { disabled?: boolean }): string {
  const base = "inline-block rounded px-4 py-2 text-sm font-medium";

  if (opts?.disabled) {
    return `${base} cursor-not-allowed bg-active text-fg-muted`;
  }

  if (variant === "primary") {
    return `${base} bg-accent text-accent-fg hover:bg-accent-hover`;
  }

  return `${base} border border-border text-fg hover:bg-active`;
}
```

Add to `src/app/globals.css`: the three `--error*` variables in all three theme blocks (`:root`, the dark media query, `:root[data-theme="dark"]`), and `--color-error`/`--color-error-bg`/`--color-error-fg` in the `@theme inline` block — copy the exact placement pattern already used for `--success`/`--success-bg`/`--success-fg`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- EventTypeBadge buttonStyles`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/EventTypeBadge.tsx src/components/EventTypeBadge.test.tsx src/lib/buttonStyles.ts src/lib/buttonStyles.test.ts src/app/globals.css
git commit -m "Add EventTypeBadge and buttonClass primitives, error color tokens"
```

## Task 2: Fix the booking-flow CTA color bug (TimeBlockPicker)

**Files:**
- Modify: `src/app/locations/[locationId]/courts/[courtId]/TimeBlockPicker.tsx`
- Test: `src/app/locations/[locationId]/courts/[courtId]/TimeBlockPicker.test.tsx` (create if it doesn't exist; check first)

**Interfaces:**
- Consumes: `buttonClass` from `src/lib/buttonStyles.ts` (Task 1).
- No prop or behavior changes — `handleClick`, `selection` state, and `bookHref` logic are unchanged.

- [ ] **Step 1: Check for an existing test file**

Run: `ls src/app/locations/\[locationId\]/courts/\[courtId\]/TimeBlockPicker.test.tsx 2>/dev/null || echo none`

If a test file exists, read it and add the two cases below alongside the existing ones. If not, create it with a minimal render test plus these two cases (use whatever `Slot` fixture shape the existing court page tests use — check `src/lib/availability.ts` for the `Slot` type).

- [ ] **Step 2: Write the failing test cases**

```tsx
it("styles a selected slot with the primary accent classes, not black", () => {
  render(<TimeBlockPicker slots={slots} timezone="America/New_York" courtHref="/x" date="2026-09-08" />);
  const button = screen.getByText("9:00 AM");
  fireEvent.click(button);
  expect(button.className).toContain("bg-accent");
  expect(button.className).not.toContain("bg-black");
});

it("does not use bg-black for the enabled Continue link", () => {
  render(<TimeBlockPicker slots={slots} timezone="America/New_York" courtHref="/x" date="2026-09-08" />);
  fireEvent.click(screen.getByText("9:00 AM"));
  const continueLink = screen.getByText("Continue");
  expect(continueLink.className).not.toContain("bg-black");
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- TimeBlockPicker`
Expected: FAIL (current classes contain `bg-black`).

- [ ] **Step 4: Implement the fix**

```tsx
import { buttonClass } from "@/lib/buttonStyles";
```

Replace the `selected` ternary (currently `"rounded border border-black bg-black px-3 py-2 text-center text-sm text-white"` vs the unselected branch) with:

```tsx
className={
  selected
    ? "rounded border border-accent bg-accent px-3 py-2 text-center text-sm text-accent-fg"
    : "rounded border border-border px-3 py-2 text-center text-sm hover:bg-active"
}
```

Replace the `bookHref` block:

```tsx
{bookHref ? (
  <Link href={bookHref} className={buttonClass("primary")}>
    Continue
  </Link>
) : (
  <button type="button" disabled className={buttonClass("primary", { disabled: true })}>
    Continue
  </button>
)}
```

- [ ] **Step 5: Run to verify tests pass**

Run: `npm test -- TimeBlockPicker`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/locations/[locationId]/courts/[courtId]/TimeBlockPicker.tsx" "src/app/locations/[locationId]/courts/[courtId]/TimeBlockPicker.test.tsx"
git commit -m "Fix booking-flow CTA to use accent token instead of black"
```

## Task 3: Auth and account pages

**Files (apply the Class Replacement Map; use `buttonClass("primary")` for the submit button in each form; use the new `--error`/`bg-active` banner treatment for messages):**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/signup/page.tsx`
- Modify: `src/app/profile/page.tsx`
- Modify: `src/app/bookings/page.tsx`
- Modify: `src/app/bookings/[bookingId]/page.tsx`
- Modify: `src/app/players/[userId]/page.tsx`
- Modify: `src/app/choose-city/page.tsx`

**Interfaces:** None — pure class-string edits, no signature or markup-structure changes except swapping a `<button className="rounded bg-black px-4 py-2 text-white">` for `<button className={buttonClass("primary")}>` (import added).

- [ ] **Step 1: Apply the Class Replacement Map to each file above.** For `login/page.tsx` and `signup/page.tsx` specifically: the info banner (`bg-blue-50...`, login only) becomes `bg-active text-fg`; the error banner becomes `bg-error-bg text-error-fg`; the `<button className="rounded bg-black px-4 py-2 text-white">` becomes `<button className={buttonClass("primary")}>` with `import { buttonClass } from "@/lib/buttonStyles";` added. The "No account? Sign up" / "Already have an account? Sign in" paragraph's `text-gray-600` becomes `text-fg-muted`.

- [ ] **Step 2: For `bookings/page.tsx`, `bookings/[bookingId]/page.tsx`, `admin/team/page.tsx`-style "Cancel"/"Remove" underlined text buttons** (there are none of those two admin-team ones in this task — just the booking cancel buttons): `text-red-700 underline` becomes `text-error-fg underline` (per the Global Constraints note — stays a text link, just recolored).

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no errors. (These pages likely have no dedicated component tests — a passing full suite plus a clean typecheck is the bar here.)

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/app/signup/page.tsx src/app/profile/page.tsx src/app/bookings/page.tsx "src/app/bookings/[bookingId]/page.tsx" "src/app/players/[userId]/page.tsx" src/app/choose-city/page.tsx
git commit -m "Sweep auth and account pages onto the token system"
```

## Task 4: Browse and booking-confirm pages

**Files:**
- Modify: `src/app/clubs/[orgId]/page.tsx`
- Modify: `src/app/locations/[locationId]/page.tsx`
- Modify: `src/app/locations/[locationId]/courts/[courtId]/page.tsx`
- Modify: `src/app/locations/[locationId]/courts/[courtId]/book/page.tsx`

**Interfaces:** None — class-string edits only. `book/page.tsx`'s info banner (`bg-blue-50...`) becomes `bg-active text-fg`; its submit button (if `bg-black`) becomes `buttonClass("primary")`.

- [ ] **Step 1: Apply the Class Replacement Map to each file.** In `clubs/[orgId]/page.tsx`, leave the map-address `<a>` exactly as `text-gray-600 underline decoration-dotted` structurally, just recolor to `text-fg-muted underline decoration-dotted` — it's intentionally distinct from `text-link` (dotted = "opens an external map", not internal navigation); don't merge it into `text-link`.

- [ ] **Step 2: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/clubs/[orgId]/page.tsx" "src/app/locations/[locationId]/page.tsx" "src/app/locations/[locationId]/courts/[courtId]/page.tsx" "src/app/locations/[locationId]/courts/[courtId]/book/page.tsx"
git commit -m "Sweep browse and booking-confirm pages onto the token system"
```

## Task 5: Events pages (apply EventTypeBadge)

**Files:**
- Modify: `src/app/events/page.tsx`
- Modify: `src/app/events/[eventId]/page.tsx`
- Modify: `src/app/events/registrations/page.tsx`

**Interfaces:**
- Consumes: `EventTypeBadge` from `src/components/EventTypeBadge.tsx` (Task 1), `buttonClass` from `src/lib/buttonStyles.ts` (Task 1).

- [ ] **Step 1: In `events/page.tsx`**, replace both occurrences of `<p className="text-sm text-gray-600">{EVENT_TYPE_LABELS[event.eventType]}</p>` with `<EventTypeBadge eventType={event.eventType} />` (add the import; the `EVENT_TYPE_LABELS` import can be removed from this file if it becomes unused). Apply the Class Replacement Map to the rest of the file (card border/hover, the "No upcoming events yet" muted text).

- [ ] **Step 2: In `events/[eventId]/page.tsx`**, find wherever `EVENT_TYPE_LABELS[event.eventType]` (or equivalent) is rendered as plain text and replace it with `<EventTypeBadge eventType={event.eventType} />` the same way. Replace the "Sign in to register" plain `<a>`/`<Link>` with the same element wrapped in `buttonClass("primary")` (import `buttonClass`). Apply the Class Replacement Map to the error banners and any remaining gray/neutral classes on this page.

- [ ] **Step 3: In `events/registrations/page.tsx`**, apply the Class Replacement Map (error banner, borders, the "Remove"/"Cancel"-style `text-red-700 underline` buttons → `text-error-fg underline`). If this page also renders an event type anywhere as plain text, swap it for `EventTypeBadge` too; if it doesn't render event type, leave it as-is (registrations are keyed by event, not necessarily labeled by type on this page — check before assuming).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/events/page.tsx "src/app/events/[eventId]/page.tsx" src/app/events/registrations/page.tsx
git commit -m "Apply EventTypeBadge and token sweep to events pages"
```

## Task 6: Admin core pages

**Files:**
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/team/page.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/locations/[locationId]/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/hours/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/hours/confirm/page.tsx`

**Interfaces:**
- Consumes: `buttonClass` from `src/lib/buttonStyles.ts` for any primary submit button (e.g. "Add a location", "Add a court", "Apply to All Courts").

- [ ] **Step 1: Apply the Class Replacement Map to all six files.** Pay particular attention to `admin/team/page.tsx`'s `text-red-700 underline` remove-member button → `text-error-fg underline`, and any `bg-black`-styled submit buttons across the location/court-add forms → `buttonClass("primary")`.

- [ ] **Step 2: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/page.tsx src/app/admin/team/page.tsx src/app/admin/layout.tsx "src/app/admin/locations/[locationId]/page.tsx" "src/app/admin/locations/[locationId]/hours/page.tsx" "src/app/admin/locations/[locationId]/hours/confirm/page.tsx"
git commit -m "Sweep admin core pages onto the token system"
```

## Task 7: Admin courts/events/bracket pages (apply EventTypeBadge where relevant)

**Files:**
- Modify: `src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx`

**Interfaces:**
- Consumes: `EventTypeBadge`, `buttonClass` (Task 1).

- [ ] **Step 1: In `admin/locations/[locationId]/courts/[courtId]/page.tsx`**, apply the Class Replacement Map, including the blocked-slot toggle button at (around) line 310-314: the conditional currently reading `slot.blocked ? "border-red-400 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300" : "border-gray-300"` becomes `slot.blocked ? "border-error-fg bg-error-bg text-error-fg" : "border-border"`. Every other `text-red-700 underline` cancel/remove button becomes `text-error-fg underline`.

- [ ] **Step 2: In `admin/locations/[locationId]/events/page.tsx` and `admin/locations/[locationId]/events/[eventId]/page.tsx`**, replace any plain-text event-type rendering with `<EventTypeBadge eventType={...} />` the same way as Task 5, and apply the Class Replacement Map to everything else (there are several error banners and underlined destructive buttons in the `[eventId]` page — all become `bg-error-bg text-error-fg` / `text-error-fg underline` respectively).

- [ ] **Step 3: In `admin/locations/[locationId]/events/[eventId]/bracket/page.tsx`**, apply the Class Replacement Map, including the bordered destructive button at (around) line 279: `"rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400"` becomes `"rounded border border-error-fg px-3 py-2 text-sm text-error-fg"`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx" "src/app/admin/locations/[locationId]/events/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx"
git commit -m "Sweep admin courts/events/bracket pages onto the token system"
```

## Task 8: Shared components (bracket UI, pickers, lookups)

**Files:**
- Modify: `src/components/bracket/MatchCardGrid.tsx`
- Modify: `src/components/bracket/MatchResultSheet.tsx`
- Modify: `src/components/SkillLevelPicker.tsx`
- Modify: `src/components/TimezoneSelect.tsx`
- Modify: `src/components/AddressLookup.tsx`

**Interfaces:** None — class-string edits only.

- [ ] **Step 1: Apply the Class Replacement Map to all five files.**

- [ ] **Step 2: In `TimezoneSelect.tsx`**, the selected-option highlight at (around) line 125 — `option.id === value ? "font-medium text-blue-700 dark:text-blue-400" : "dark:text-neutral-100"` — becomes `option.id === value ? "font-medium text-accent" : "text-fg"` (the unselected branch's `dark:text-neutral-100` had no light-mode counterpart set, meaning it was relying on inherited body color in light mode already — make it explicit as `text-fg` for both themes rather than leaving it implicit).

- [ ] **Step 3: In `MatchResultSheet.tsx`**, the error paragraph (`rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-300`) becomes `rounded bg-error-bg p-2 text-xs text-error-fg`.

- [ ] **Step 4: In `AddressLookup.tsx`**, the error text (`text-xs text-red-700 dark:text-red-400`) becomes `text-xs text-error-fg`; the "Look up address" button (`border border-gray-400 ... dark:border-neutral-600 dark:text-neutral-100`) becomes `buttonClass("secondary")` (import `buttonClass`) if it's a plain trigger button, not a form submit — check its `type` attribute; if `type="button"` it's safe to swap wholesale.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — `SkillLevelPicker.test.tsx`, `ThemeToggle.test.tsx`, and any bracket component tests must stay green; these are class-only edits so no assertion should need to change unless a test asserts on a literal class string (check for that specifically in `SkillLevelPicker.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/bracket/MatchCardGrid.tsx src/components/bracket/MatchResultSheet.tsx src/components/SkillLevelPicker.tsx src/components/TimezoneSelect.tsx src/components/AddressLookup.tsx
git commit -m "Sweep remaining shared components onto the token system"
```

## Task 9: Sweep remaining yellow/green status colors app-wide

Discovered mid-execution (after Task 3): a parallel legacy-color pattern using `yellow`/`green` for pending/warning and confirmed/success states, missed by the plan's original grep (which only searched black/gray/blue/red/neutral). Same treatment as every other task — reuse existing tokens, no new ones needed: green → `--success`/`--success-bg`/`--success-fg` (already exists, used by `SuccessBanner`), yellow → `--status`/`--status-fg` (already exists, used by the homepage's event-type pill).

**Files:**
- Modify: `src/components/AddressLookup.tsx`
- Modify: `src/app/events/[eventId]/page.tsx`
- Modify: `src/app/events/registrations/page.tsx`
- Modify: `src/app/bookings/[bookingId]/page.tsx`
- Modify: `src/app/bookings/page.tsx`
- Modify: `src/app/profile/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/page.tsx`
- Modify: `src/components/bracket/InteractiveBracket.tsx`
- Modify: `src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx`

**Interfaces:** None — class-string edits only, using the yellow/green rows of the Class Replacement Map above.

- [ ] **Step 1: Run this exact search to find every occurrence before starting, since line numbers above may have shifted after Tasks 3-8's edits:**

Run: `grep -rn "bg-yellow-\|text-yellow-\|bg-green-\|text-green-\|border-yellow-\|border-green-" src/`

- [ ] **Step 2: Apply the yellow/green rows of the Class Replacement Map to every match**, using judgment for semantics per file (a green "Paid ✓"/"Saved."/"confirmed" badge is success; a yellow "waitlisted"/"pending"/"incomplete profile" banner or badge is status).

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AddressLookup.tsx "src/app/events/[eventId]/page.tsx" src/app/events/registrations/page.tsx "src/app/bookings/[bookingId]/page.tsx" src/app/bookings/page.tsx src/app/profile/page.tsx "src/app/admin/locations/[locationId]/page.tsx" src/components/bracket/InteractiveBracket.tsx "src/app/admin/locations/[locationId]/courts/[courtId]/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/bracket/page.tsx"
git commit -m "Sweep remaining yellow/green status colors onto success/status tokens"
```

## Final Check

After all 9 tasks:
- [ ] `npm test` — full suite green (249 existing + new tests from Tasks 1-2).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean (this app's lint has previously caught real regressions; don't skip it even though the plan didn't call it out per-task).
- [ ] `grep -rE "bg-black|text-gray-|bg-gray-|border-gray-|bg-blue-|text-blue-|bg-red-|text-red-|bg-yellow-|text-yellow-|bg-green-|text-green-|border-yellow-|border-green-|dark:.*-neutral-|dark:.*-red-|dark:.*-blue-|dark:.*-yellow-|dark:.*-green-" src/` returns nothing outside of `globals.css` itself (which defines what the tokens mean, not a violation) and any file this plan deliberately didn't touch (there shouldn't be any — all 30 identified files plus Task 9's 11 files are covered across Tasks 3-9).
- [ ] Manually verify in the browser (light + dark, desktop + mobile): booking flow slot selection is now orange, not black; an event's type shows as a colored pill on `/events`, `/events/[id]`, and the admin events pages consistently; login/signup have no leftover blue/red/gray/black; a booking cancellation and an admin "remove member" action still visually read as destructive (red-ish `--error-fg`), just tokenized.
