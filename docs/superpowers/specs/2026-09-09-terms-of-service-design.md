# Terms of Service Acceptance — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-09

## Goal

Turn the static, unwired `docs/legal/terms-of-service-draft.md` into a
real acceptance flow: every account has to affirmatively agree, the
agreement is timestamped and tied to a specific document version, and a
later revision of the document re-prompts everyone rather than silently
grandfathering existing acceptances in.

Confirmed with the user up front: the draft ships **as-is**, brackets
and all — it's explicitly marked as a draft/placeholder in its own
header, and the user will supply real business/jurisdiction specifics
later. This spec is about the *mechanism*, not the legal content.

## Version tracking

```sql
alter table users add column tos_accepted_version text;
alter table users add column tos_accepted_at timestamptz;
```

No check constraint — freeform, same as every other profile text field.
No RLS change: both columns are self-editable under the existing `users
update own` policy (`0002_rls.sql`), and neither is the kind of
privilege column `0023_protect_users_identity_columns.sql` exists to
pin.

A single constant, `CURRENT_TOS_VERSION = "2026-09-09"`
(`src/lib/terms.ts`), is the source of truth for "the current version" —
independent of the document's own "Last updated" line, so bumping the
version is always an explicit code change, never inferred by parsing
the markdown. A pure `hasAcceptedCurrentTerms(user: {
tos_accepted_version }): boolean` (built test-first) backs every gate
below. Bumping `CURRENT_TOS_VERSION` after a real revision re-prompts
every account on its next sign-in — nobody's old acceptance silently
carries forward to a document they never saw.

## Content rendering — one source of truth

`docs/legal/terms-of-service-draft.md` stays the single canonical copy
of the text (so a future real-document swap is a one-file edit, not a
find-and-replace across a duplicated JSX copy). A small, purpose-built
parser, `parseMarkdownLite(text: string): Block[]` (`src/lib/markdownLite.ts`,
built test-first), turns it into a block list — heading (1-3),
paragraph, bullet list, horizontal rule, blockquote — covering exactly
the markdown features this one document uses, not general-purpose
markdown. No markdown library added, matching this codebase's existing
calls (`.ics` generation, calendar links) to hand-roll something this
narrowly scoped rather than pull in a dependency. Inline `**bold**`
splitting happens at render time in the (untested, presentational)
page component that turns blocks into JSX — simple regex-split, not
part of the tested block parser. The file is read server-side via
`fs.readFileSync` at request time, so an edit to the `.md` file is live
immediately with no rebuild.

## Two gates, one recorded event

**Signup form** (`src/app/signup/page.tsx`): a required checkbox — "I
agree to the [Terms of Service and Acceptable Use Policy](/terms)"
(opens in a new tab so the in-progress form isn't lost) — blocks
submission client-side via the native `required` attribute, no JS
needed. `signUp` (`src/app/actions/auth.ts`) also checks server-side
that the checkbox was submitted, rejecting a raw POST that skips it —
matching this codebase's existing pattern of never trusting a
client-side-only constraint for something that matters (e.g. the
gender/skill-level allowlist check in `updateProfile`).

This checkbox **does not itself write anything** — `supabase.auth
.signUp()` has no authenticated session yet (email confirmation
required first), the same constraint every other "at signup" attempt in
this codebase has already hit (team-roster-invite, user-profiles,
city-personalization) and solved the same way: defer the actual write to
the first real authenticated moment.

**`/accept-terms`** is that moment — a mandatory (not skippable, unlike
`/choose-city`) interstitial shown on sign-in whenever the signed-in
account's `tos_accepted_version` doesn't match `CURRENT_TOS_VERSION`.
Renders the current document (same renderer as `/terms`) plus an "I
Agree and Continue" button; its server action verifies the caller is
signed in, records `tos_accepted_version = CURRENT_TOS_VERSION,
tos_accepted_at = now()` (with the same zero-row-affected check this
codebase already established for exactly this failure class —
`setDefaultCity`, `updateProfile`, `cancelEventRegistration`), then
resolves onward to wherever sign-in would otherwise have sent them.

This is the one and only place actual acceptance is recorded — for a
brand-new account that just checked the signup box seconds earlier, and
for every pre-existing account (all of whom start with
`tos_accepted_version IS NULL`) alike, and for any account after a real
future version bump. Seeing the same document once more, right after
signup, is a deliberate, small redundancy in exchange for a single,
uniform, always-authenticated mechanism instead of two different
recording paths.

`signIn` (`src/app/actions/auth.ts`) gets the ToS check inserted as the
very **first** post-login branch — before even the existing `next`
redirect. This is a deliberate difference from the city-prompt, which
is intentionally skippable via a deep link (its own comment says so
explicitly): a legal consent gate must not be bypassable by a link,
where a UX nudge can be. `next` (and the org-membership /
city-prompt-eligibility decision) is preserved through `/accept-terms`
via a `?next=` query param and resolved after acceptance — extracted
into one shared helper, `resolvePostAuthRedirect(supabase, userId,
next)` (`src/lib/authRedirect.ts`), so `signIn` and `/accept-terms`'s
action can't drift into two different ideas of "where does this person
actually belong." `claim_pending_team_invites` stays unconditional,
before the ToS check — harmless regardless of acceptance status.

## Pages

- **`/terms`** — public, no auth required, no acceptance gate of its
  own (a not-yet-signed-up visitor, or someone who already accepted,
  can read it anytime). Renders the current document via the shared
  parser.
- **`/accept-terms`** — same rendered document, plus the accept form.
  Redirects to `/login?next=/accept-terms...` if visited signed out.
  No skip option.
- **`/profile`** gains a plain "View Terms of Service" link to `/terms`
  so an already-accepted player can revisit it anytime — the only
  in-app entry point besides signup/first-login, since this app has no
  site-wide footer to hang a persistent link on today (not adding one
  now — out of scope, a bigger layout decision nobody's asked for).

## Explicitly out of scope

- No re-acceptance banner/reminder on every page for an already-past-due
  account beyond the sign-in gate itself — same enforcement shape as
  `/choose-city` (checked once, at the sign-in transition, not on every
  subsequent request via middleware). A session that's already past the
  sign-in point when a version bumps ships won't be interrupted
  mid-session; they'll be gated on their next sign-in.
- No admin-facing view of who has/hasn't accepted, or which version.
  Not asked for, and this data isn't otherwise surfaced to admins for
  any other profile field either.
- No email notification when the document changes — "Changes to These
  Terms" in the draft itself says only that a material change gets
  "reasonable steps to notify," which the re-prompt-on-next-sign-in gate
  already satisfies for this app's purposes; a proactive email is a
  separate, unscoped feature.
- Payments section (§7 of the draft) stays a placeholder — correctly,
  since v4 (Stripe Connect) hasn't shipped.

## Testing plan

- `hasAcceptedCurrentTerms` — unit-tested test-first: matching version,
  null version, stale version.
- `parseMarkdownLite` — unit-tested test-first against representative
  fragments of the actual document: a heading, a paragraph, a bullet
  list, a horizontal rule, a blockquote, and a multi-block sequence
  matching the real file's opening (blockquote, then a heading, then a
  paragraph).
- No new tests for the pages, `signIn`/`signUp`/`acceptTerms` actions,
  or `resolvePostAuthRedirect` — consistent with this codebase's
  established convention of verifying server actions/pages live rather
  than unit-testing them.

## Manual verification plan

- Apply the migration; confirm `/terms` renders the full document
  (including the top draft-disclaimer blockquote) with headings, bold,
  and the bullet list all visibly distinct from plain paragraphs.
- Sign up a fresh account without checking the box — confirm the
  browser blocks submission (native `required`); confirm a raw POST
  with the checkbox omitted is also rejected server-side.
- Sign up with the box checked, confirm the account, sign in for the
  first time — confirm the mandatory `/accept-terms` interstitial
  appears (not skippable), and that clicking through lands on the
  normal post-login destination (home, since this fresh account has no
  org membership and hasn't set a city yet — should proceed to the
  existing `/choose-city` check next, not skip it).
- Sign in as an existing pre-feature test account (`tos_accepted_version
  IS NULL`) with a deep `next` link — confirm `/accept-terms` still
  intercepts before `next`, and that accepting lands back on the
  original `next` target, not home.
- Sign in as an org-admin test account with no city preference set —
  confirm the order is accept-terms, then `/admin` (not `/choose-city`,
  matching the existing org-admin exemption).
- After accepting, sign out and back in again — confirm `/accept-terms`
  does *not* reappear (version already matches).
- Bump `CURRENT_TOS_VERSION` locally, sign in again on an
  already-accepted account — confirm it re-prompts; revert the bump
  afterward.
- Confirm `/profile`'s "View Terms of Service" link works both before
  and after acceptance.
