# Terms of Service Acceptance Implementation Plan

**Goal:** Wire up a real, versioned, timestamped acceptance flow for the
existing `docs/legal/terms-of-service-draft.md`, shipped as-is (draft
content, per the user's explicit choice).

**Spec:** `docs/superpowers/specs/2026-09-09-terms-of-service-design.md`

**Note:** implemented directly this session, task-by-task, no subagent
dispatch — same call as the last two small features.

## Tasks

1. **Migration `0042_terms_of_service.sql`** — `users.tos_accepted_version`,
   `users.tos_accepted_at`. Apply via `npm run migrate`.

2. **`src/lib/terms.ts` + test** — `CURRENT_TOS_VERSION`,
   `hasAcceptedCurrentTerms`, test-first.

3. **`src/lib/markdownLite.ts` + test** — `parseMarkdownLite`, test-first
   against real fragments of the draft doc.

4. **`src/lib/authRedirect.ts`** — `resolvePostAuthRedirect(supabase,
   userId, next)`, extracted from `signIn`'s existing next → membership
   → city-prompt → home logic.

5. **`/terms` page** — reads the draft `.md` via `fs.readFileSync`,
   renders through `parseMarkdownLite` + a small JSX block renderer
   (inline bold handled here, untested).

6. **`/accept-terms` page + `acceptTerms` action** — same renderer, "I
   Agree and Continue" button, records acceptance, resolves onward via
   `resolvePostAuthRedirect`. No skip option.

7. **`signIn` rewire** (`src/app/actions/auth.ts`) — ToS check first
   (before `next`), redirect to `/accept-terms?next=...` if not
   accepted; otherwise use `resolvePostAuthRedirect`.

8. **Signup form** (`src/app/signup/page.tsx`) — required checkbox
   linking to `/terms` (new tab); `signUp` action rejects a submission
   missing it.

9. **`/profile`** — add a "View Terms of Service" link.

10. **Manual verification** per the spec's plan — fresh signup, existing
    pre-feature account, org-admin account, deep-link `next`, version
    bump/re-prompt, sign-out/sign-in-again no-reprompt.

`npm test` + `tsc --noEmit` + `npm run lint` clean before calling this
done.
