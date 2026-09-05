# Manual Venmo Payments for Event Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org charge a flat registration fee for an event, collected manually via Venmo, with a "pending → paid/refunded" status an org member tracks in the app and a registrant sees on their own registration.

**Architecture:** Two new nullable columns (`organizations.venmo_handle`, `events.fee_cents`) plus one new `security definer` RPC. `event_registrations.payment_status` already exists, unused, since the registration plan shipped — this plan is the first thing to read or write it. `registerForEvent` starts it at `pending`/`not_required` based on the event's fee; two new admin actions (`markRegistrationPaid`, `markRegistrationRefunded`) move it to `paid`/`refunded`. No new background jobs, no payment processing, no webhooks — everything is manual confirmation, matching the spec's explicit non-goals.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS), Resend (existing email setup), Vitest for pure-function unit tests.

**Spec:** `docs/superpowers/specs/2026-09-05-venmo-manual-payments-design.md`

## Global Constraints

- Venmo handle lives on `organizations`, one per org, reused for every paid event that org creates.
- Fee is a flat `fee_cents` per event, charged once per registration (individual or team) regardless of roster size — never per-player.
- Any org member (owner, admin, or staff) can mark a registration paid or refunded — no extra role gating beyond existing `event_registrations` RLS.
- A `pending` registration holds its capacity spot exactly like a `paid` one — no auto-expiry, no payment deadline logic.
- The Venmo deep link (`https://venmo.com/?txn=pay&recipients=...`) is an unofficial-but-stable convention, not a documented API — the plain handle + amount must always be shown as text alongside it, never only the link.
- A paid event can never exist with no way to collect payment: both `createEvent` and `updateEvent` reject a nonzero `fee_cents` if the org has no `venmo_handle` set.
- `markRegistrationPaid` sends a confirmation email (reusing the existing Resend setup); `markRegistrationRefunded` does not.

---

## Task 1: Schema — Venmo handle, event fee, notification RPC

**Files:**
- Create: `supabase/migrations/0030_venmo_payments.sql`

**Interfaces:**
- Produces: `organizations.venmo_handle` (nullable text), `events.fee_cents` (nullable integer), RPC `get_registration_notification_email(p_registration_id uuid) returns table(email text)`.

- [ ] **Step 1: Write the migration**

```sql
-- Manual Venmo payments for event registration -- see
-- docs/superpowers/specs/2026-09-05-venmo-manual-payments-design.md.
-- event_registrations.payment_status has existed unused since
-- 0017_event_registration.sql; this is the first thing to read or write
-- it. Both new columns are nullable with no backfill, matching every
-- other optional column added to these tables.

alter table organizations add column venmo_handle text;
alter table events add column fee_cents integer;

-- Needed so markRegistrationPaid (src/app/admin/eventActions.ts) can
-- email the registrant a payment confirmation -- users' own RLS ("users
-- select own") doesn't let an org member read another user's email
-- directly. Same pattern as get_booking_notification_email (0026):
-- gated by the exact condition event_registrations' own update policy
-- already uses ("event_registrations update own or captain or member"),
-- so this doesn't expose anything the caller couldn't already act on.
-- Resolves to the individual registrant's email, or the team captain's
-- for a team registration -- the captain is the one who pays, per the
-- flat-fee decision.
create function public.get_registration_notification_email(p_registration_id uuid)
returns table(email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.email
  from event_registrations r
  join users u on u.id = coalesce(
    r.user_id,
    (select t.captain_user_id from event_teams t where t.id = r.team_id)
  )
  where r.id = p_registration_id
    and public.is_org_member(public.org_id_for_event(r.event_id));
$$;

grant execute on function public.get_registration_notification_email(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Run: `npm run migrate -- supabase/migrations/0030_venmo_payments.sql`
Expected: `Applied supabase/migrations/0030_venmo_payments.sql`

- [ ] **Step 3: Verify the new columns and function exist**

Run:

```bash
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)\$/m)[1].trim().replace(/^\"|\"\$/g, '');
const { Client } = require('pg');
const c = new Client({ connectionString: url });
c.connect().then(async () => {
  const cols = await c.query(\"select column_name from information_schema.columns where (table_name = 'organizations' and column_name = 'venmo_handle') or (table_name = 'events' and column_name = 'fee_cents')\");
  console.log('columns:', cols.rows);
  const fn = await c.query(\"select proname from pg_proc where proname = 'get_registration_notification_email'\");
  console.log('function:', fn.rows);
  await c.end();
});
"
```

Expected: `columns:` lists both `venmo_handle` and `fee_cents`; `function:` lists one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0030_venmo_payments.sql
git commit -m "Add venmo_handle, fee_cents, and payment notification RPC"
```

---

## Task 2: Pure helpers — payment status, currency formatting, Venmo link

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`
- Create: `src/lib/venmoLink.ts`
- Create: `src/lib/venmoLink.test.ts`
- Modify: `src/lib/eventRegistration.ts`
- Modify: `src/lib/eventRegistration.test.ts`

**Interfaces:**
- Produces: `formatCents(cents: number): string`, `buildVenmoPaymentUrl({ handle: string; amountCents: number; note: string }): string`, `initialPaymentStatus(feeCents: number | null): "pending" | "not_required"`.

- [ ] **Step 1: Write the failing tests for `formatCents`**

```ts
// src/lib/money.test.ts
import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/money";

describe("formatCents", () => {
  it("formats whole dollars with two decimal places", () => {
    expect(formatCents(2500)).toBe("$25.00");
  });

  it("formats cents that aren't a whole dollar", () => {
    expect(formatCents(150)).toBe("$1.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/money.test.ts`
Expected: FAIL — `Cannot find module '@/lib/money'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `formatCents`**

```ts
// src/lib/money.ts
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/money.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the failing tests for `buildVenmoPaymentUrl`**

```ts
// src/lib/venmoLink.test.ts
import { describe, expect, it } from "vitest";
import { buildVenmoPaymentUrl } from "@/lib/venmoLink";

describe("buildVenmoPaymentUrl", () => {
  it("builds a pay link with handle, amount, and note", () => {
    const url = buildVenmoPaymentUrl({
      handle: "ace-volleyball",
      amountCents: 2500,
      note: "Fall Open Tournament",
    });
    expect(url).toBe(
      "https://venmo.com/?txn=pay&recipients=ace-volleyball&amount=25.00&note=Fall+Open+Tournament"
    );
  });

  it("formats a non-whole-dollar amount to two decimal places", () => {
    const url = buildVenmoPaymentUrl({ handle: "ace-volleyball", amountCents: 1050, note: "x" });
    expect(url).toContain("amount=10.50");
  });

  it("URL-encodes special characters in the note", () => {
    const url = buildVenmoPaymentUrl({
      handle: "ace-volleyball",
      amountCents: 100,
      note: "Jane's Team — Fall",
    });
    const params = new URL(url).searchParams;
    expect(params.get("note")).toBe("Jane's Team — Fall");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/venmoLink.test.ts`
Expected: FAIL — `Cannot find module '@/lib/venmoLink'`.

- [ ] **Step 7: Implement `buildVenmoPaymentUrl`**

```ts
// src/lib/venmoLink.ts
export function buildVenmoPaymentUrl({
  handle,
  amountCents,
  note,
}: {
  handle: string;
  amountCents: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    txn: "pay",
    recipients: handle,
    amount: (amountCents / 100).toFixed(2),
    note,
  });
  return `https://venmo.com/?${params.toString()}`;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run src/lib/venmoLink.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Write the failing tests for `initialPaymentStatus`**

Add to `src/lib/eventRegistration.test.ts` (append after the existing `determineRegistrationStatus` describe block):

```ts
import { determineRegistrationStatus, initialPaymentStatus } from "@/lib/eventRegistration";

// (update the existing import line at the top of the file to include
// initialPaymentStatus alongside determineRegistrationStatus)

describe("initialPaymentStatus", () => {
  it("is not_required when there's no fee", () => {
    expect(initialPaymentStatus(null)).toBe("not_required");
    expect(initialPaymentStatus(0)).toBe("not_required");
  });

  it("is pending when there's a positive fee", () => {
    expect(initialPaymentStatus(2500)).toBe("pending");
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run src/lib/eventRegistration.test.ts`
Expected: FAIL — `initialPaymentStatus is not a function`.

- [ ] **Step 11: Implement `initialPaymentStatus`**

Append to `src/lib/eventRegistration.ts`:

```ts
export function initialPaymentStatus(feeCents: number | null): "pending" | "not_required" {
  return feeCents !== null && feeCents > 0 ? "pending" : "not_required";
}
```

- [ ] **Step 12: Run it to verify it passes**

Run: `npx vitest run src/lib/eventRegistration.test.ts`
Expected: 8 passed (6 existing + 2 new).

- [ ] **Step 13: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 14: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/venmoLink.ts src/lib/venmoLink.test.ts src/lib/eventRegistration.ts src/lib/eventRegistration.test.ts
git commit -m "Add formatCents, buildVenmoPaymentUrl, and initialPaymentStatus helpers"
```

---

## Task 3: Payment-confirmation email

**Files:**
- Modify: `src/lib/email.ts`
- Modify: `src/lib/email.test.ts`

**Interfaces:**
- Consumes: `formatCents` from `@/lib/money` (Task 2).
- Produces: `PaymentEmailDetails` interface, `buildPaymentConfirmationEmail(details: PaymentEmailDetails): EmailContent`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/email.test.ts` (add `buildPaymentConfirmationEmail` to the existing import line at the top):

```ts
describe("buildPaymentConfirmationEmail", () => {
  const details = {
    eventTitle: "Fall Open Tournament",
    amountCents: 2500,
    registrantLabel: "Spike Force",
    eventUrl: "https://court-scheduler-gold.vercel.app/events/abc-123",
  };

  it("includes the event title, registrant label, and formatted amount", () => {
    const email = buildPaymentConfirmationEmail(details);
    expect(email.subject).toBe("Payment received");
    expect(email.text).toContain("Fall Open Tournament");
    expect(email.text).toContain("Spike Force");
    expect(email.text).toContain("$25.00");
    expect(email.html).toContain("Spike Force");
    expect(email.html).toContain("$25.00");
  });

  it("links back to the event page", () => {
    const email = buildPaymentConfirmationEmail(details);
    expect(email.text).toContain("https://court-scheduler-gold.vercel.app/events/abc-123");
    expect(email.html).toContain('href="https://court-scheduler-gold.vercel.app/events/abc-123"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/email.test.ts`
Expected: FAIL — `buildPaymentConfirmationEmail is not a function`.

- [ ] **Step 3: Implement `buildPaymentConfirmationEmail`**

Add near the top of `src/lib/email.ts` (after the existing `import` line, which becomes
`import { buildGoogleCalendarUrl, buildIcsContent, buildOutlookCalendarUrl } from "@/lib/calendarLinks";`
followed by a new `import { formatCents } from "@/lib/money";`), and add the function itself after `buildBookingCancellationEmail` (before the module-private `escapeHtml` function — `buildPaymentConfirmationEmail` calls the existing `escapeHtml`, so it must be declared after `escapeHtml` or after its hoisted `function` declaration; since `escapeHtml` is a `function` declaration it's hoisted, so placement doesn't actually matter, but keep it grouped with the other `build*` functions for readability):

```ts
export interface PaymentEmailDetails {
  eventTitle: string;
  amountCents: number;
  registrantLabel: string;
  eventUrl: string;
}

export function buildPaymentConfirmationEmail(details: PaymentEmailDetails): EmailContent {
  const amount = formatCents(details.amountCents);
  return {
    subject: "Payment received",
    text: [
      `We've recorded your payment for ${details.eventTitle}:`,
      "",
      `${details.registrantLabel} · ${amount}`,
      "",
      `View event: ${details.eventUrl}`,
    ].join("\n"),
    html: [
      `<p>We've recorded your payment for ${escapeHtml(details.eventTitle)}:</p>`,
      `<p>${escapeHtml(details.registrantLabel)} · ${amount}</p>`,
      `<p><a href="${details.eventUrl}">View event</a></p>`,
    ].join("\n"),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/email.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts
git commit -m "Add buildPaymentConfirmationEmail"
```

---

## Task 4: Wire payment_status into registerForEvent

**Files:**
- Modify: `src/app/actions/events.ts`

**Interfaces:**
- Consumes: `initialPaymentStatus` from `@/lib/eventRegistration` (Task 2).

- [ ] **Step 1: Add `fee_cents` to the event select and import `initialPaymentStatus`**

In `src/app/actions/events.ts`, change the import line:

```ts
import { determineRegistrationStatus, initialPaymentStatus } from "@/lib/eventRegistration";
```

Change the event select (currently `.select("event_type, capacity, registration_mode, team_formation, status")`):

```ts
  const { data: event } = await supabase
    .from("events")
    .select("event_type, capacity, fee_cents, registration_mode, team_formation, status")
    .eq("id", eventId)
    .single();
```

- [ ] **Step 2: Set `payment_status` on the registration insert**

Change the final insert (currently ending `display_name: teamId ? null : displayName || null,`):

```ts
  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
    display_name: teamId ? null : displayName || null,
    payment_status: initialPaymentStatus(event.fee_cents),
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev` or the project's usual preview flow). Register for an existing free event as a test player; confirm in the database (`select payment_status from event_registrations order by registered_at desc limit 1;` via the project's `npm run migrate`-adjacent `pg` connection, or the Supabase dashboard) that the new row has `payment_status = 'not_required'` — unchanged from today's behavior. (A paid-event registration can't be tested yet — Task 6 adds the only way to set a fee on an event.)

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "Set payment_status on registration based on the event's fee"
```

---

## Task 5: Org Venmo handle settings

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Produces: `updateOrganization(formData: FormData)` server action.

- [ ] **Step 1: Add the `updateOrganization` action**

Add to `src/app/admin/actions.ts`, near `updateLocation` (no new imports needed — `revalidatePath`, `redirect`, and `createClient` are already imported at the top of this file):

```ts
export async function updateOrganization(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const venmoHandle = String(formData.get("venmo_handle") || "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ venmo_handle: venmoHandle })
    .eq("id", orgId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  redirect("/admin?org_updated=1");
}
```

- [ ] **Step 2: Fetch the org's current Venmo handle in `/admin`**

In `src/app/admin/page.tsx`, add a query right after the existing `membership` lookup (before the `locations` query):

```ts
  const { data: org } = await supabase
    .from("organizations")
    .select("venmo_handle")
    .eq("id", membership.orgId)
    .single();
```

- [ ] **Step 3: Add the `org_updated` param and an "Edit club settings" disclosure**

Update the `searchParams` type (currently `{ location_added?: string }`) to `{ location_added?: string; org_updated?: string }`, and destructure `org_updated` alongside `location_added`.

Import `updateOrganization` alongside the existing `createLocation` import:

```ts
import { createLocation, updateOrganization } from "@/app/admin/actions";
```

Add the disclosure right after the existing `{isOwnerOrAdmin(membership.role) && (<Link href="/admin/team" ...>Team &rarr;</Link>)}` block:

```tsx
      {isOwnerOrAdmin(membership.role) && (
        <details className="mt-4">
          <summary className="w-fit cursor-pointer text-sm underline">Edit club settings</summary>
          <form action={updateOrganization} className="mt-2 flex max-w-sm flex-col gap-3">
            <input type="hidden" name="org_id" value={membership.orgId} />
            <label className="flex flex-col gap-1 text-sm">
              Venmo handle (for paid events)
              <input
                name="venmo_handle"
                defaultValue={org?.venmo_handle ?? ""}
                placeholder="your-venmo-handle"
                className="rounded border px-3 py-2"
              />
            </label>
            <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
              Save
            </button>
          </form>
        </details>
      )}
      {org_updated && <SuccessBanner>Club settings saved.</SuccessBanner>}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Manual verification**

Sign in as an org owner/admin, go to `/admin`, expand "Edit club settings," enter a Venmo handle (e.g. `test-handle`), save; confirm the banner appears and the field is pre-filled with the saved value on reload. Sign in as a `staff`-role member of the same org (or check the code path directly) and confirm the disclosure is absent for them, matching `isOwnerOrAdmin`.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actions.ts src/app/admin/page.tsx
git commit -m "Add org-level Venmo handle setting"
```

---

## Task 6: Event fee field, with a venmo-handle guard

**Files:**
- Modify: `src/app/admin/eventActions.ts`
- Modify: `src/app/admin/locations/[locationId]/events/page.tsx`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `organizations.venmo_handle`, `events.fee_cents` (Task 1).
- Produces: `fee_cents` now included in `eventFieldsFromFormData`'s return shape.

- [ ] **Step 1: Add the venmo-handle guard helper and wire it into `eventFieldsFromFormData`**

In `src/app/admin/eventActions.ts`, add a type import at the top (alongside the existing imports):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
```

Add this helper function near the top of the file (after the `EXCLUSION_VIOLATION` constant, before `eventFieldsFromFormData`):

```ts
async function resolveVenmoHandle(supabase: SupabaseClient, locationId: string): Promise<string | null> {
  const { data } = await supabase
    .from("locations")
    .select("organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();
  const org = data ? (Array.isArray(data.organization) ? data.organization[0] : data.organization) : null;
  return org?.venmo_handle ?? null;
}
```

Change `eventFieldsFromFormData` to parse a `fee_dollars` field into cents:

```ts
function eventFieldsFromFormData(formData: FormData) {
  const registrationMode = String(formData.get("registration_mode") || "individual");
  const teamFormationInput = String(formData.get("team_formation") || "");
  const capacity = String(formData.get("capacity") || "");
  const feeDollars = String(formData.get("fee_dollars") || "").trim();

  return {
    event_type: String(formData.get("event_type") || "tournament"),
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || "") || null,
    registration_mode: registrationMode,
    team_formation: registrationMode === "team" ? teamFormationInput || "self_formed" : null,
    capacity: capacity ? Number(capacity) : null,
    fee_cents: feeDollars ? Math.round(Number(feeDollars) * 100) : null,
    status: String(formData.get("status") || "draft"),
  };
}
```

- [ ] **Step 2: Guard `createEvent` and `updateEvent`**

Change `createEvent`:

```ts
export async function createEvent(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const fields = eventFieldsFromFormData(formData);

  const supabase = await createClient();

  if (fields.fee_cents) {
    const venmoHandle = await resolveVenmoHandle(supabase, locationId);
    if (!venmoHandle) {
      redirect(
        `/admin/locations/${locationId}/events?event_error=${encodeURIComponent("Set your club's Venmo handle on the club dashboard before charging a fee.")}`
      );
    }
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({ location_id: locationId, ...fields })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events`);
  redirect(`/admin/locations/${locationId}/events/${event.id}?event_added=1`);
}
```

Change `updateEvent`:

```ts
export async function updateEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const fields = eventFieldsFromFormData(formData);

  const supabase = await createClient();

  if (fields.fee_cents) {
    const venmoHandle = await resolveVenmoHandle(supabase, locationId);
    if (!venmoHandle) {
      redirect(
        `/admin/locations/${locationId}/events/${eventId}?event_error=${encodeURIComponent("Set your club's Venmo handle on the club dashboard before charging a fee.")}`
      );
    }
  }

  const { error } = await supabase
    .from("events")
    .update(fields)
    .eq("id", eventId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?event_saved=1`);
}
```

- [ ] **Step 3: Add the fee field to the "Add an Event" form**

In `src/app/admin/locations/[locationId]/events/page.tsx`, change the `location` query to also fetch the org's Venmo handle:

```ts
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();
```

After the `if (!location) { notFound(); }` check, derive the handle:

```ts
  const org = Array.isArray(location.organization) ? location.organization[0] : location.organization;
  const hasVenmoHandle = Boolean(org?.venmo_handle);
```

Add `{ event_error?: string }` to this page's props type (it currently has no `searchParams` prop at all — add one: `searchParams: Promise<{ event_error?: string }>` as a sibling to `params` in the function signature) and destructure it: `const { event_error } = await searchParams;`.

Render the error banner right after the `<h1>`:

```tsx
      {event_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {event_error}
        </p>
      )}
```

Add the fee field to the form, right after the "Capacity" label block:

```tsx
        {hasVenmoHandle ? (
          <label className="flex flex-col gap-1 text-sm">
            Fee (blank = free)
            <input
              name="fee_dollars"
              type="number"
              min="0"
              step="0.01"
              placeholder="25.00"
              className="rounded border px-3 py-2"
            />
          </label>
        ) : (
          <p className="text-xs text-gray-600 dark:text-neutral-400">
            Set your club&apos;s Venmo handle on the{" "}
            <Link href="/admin" className="underline">
              club dashboard
            </Link>{" "}
            to charge a fee for this event.
          </p>
        )}
```

(This page already imports `Link` from `next/link` at the top.)

- [ ] **Step 4: Add the fee field to the "Edit event details" form**

In `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`, change the `location` query to also fetch the org's Venmo handle:

```ts
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, timezone, organization:organizations(venmo_handle)")
    .eq("id", locationId)
    .single();
```

After the `if (!location) { notFound(); }` check, derive the handle:

```ts
  const org = Array.isArray(location.organization) ? location.organization[0] : location.organization;
  const hasVenmoHandle = Boolean(org?.venmo_handle);
```

Add `fee_cents` to the `event` select (currently `.select("id, title, description, event_type, registration_mode, team_formation, capacity, status")`):

```ts
  const { data: event } = await supabase
    .from("events")
    .select("id, title, description, event_type, registration_mode, team_formation, capacity, fee_cents, status")
    .eq("id", eventId)
    .eq("location_id", locationId)
    .single();
```

Add `event_error` to the `searchParams` type (alongside the existing `session_error`, etc.) and destructure it.

Render the error banner alongside the existing `session_error` banner:

```tsx
      {event_error && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {event_error}
        </p>
      )}
```

Add the fee field inside the "Edit event details" `<form>`, right after the "Capacity" label block:

```tsx
          {hasVenmoHandle ? (
            <label className="flex flex-col gap-1 text-sm">
              Fee (blank = free)
              <input
                name="fee_dollars"
                type="number"
                min="0"
                step="0.01"
                defaultValue={event.fee_cents ? (event.fee_cents / 100).toFixed(2) : ""}
                className="rounded border px-3 py-2"
              />
            </label>
          ) : (
            <p className="text-xs text-gray-600 dark:text-neutral-400">
              Set your club&apos;s Venmo handle on the{" "}
              <Link href="/admin" className="underline">
                club dashboard
              </Link>{" "}
              to charge a fee for this event.
            </p>
          )}
```

This file already imports `Link` from `next/link` at the top, so no import change is needed for the link in the note above.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Manual verification**

With no Venmo handle set on the org, confirm the "Add an Event" form shows the "set your club's Venmo handle" note instead of a fee field, and the "Edit event details" form does the same for an existing event. Set a Venmo handle (Task 5), reload both pages, confirm the fee field now appears. Create a new event with a $25.00 fee; confirm in the database that `fee_cents = 2500`. Edit that event's fee to $10.00; confirm it updates to `1000`. Clear the fee field and save; confirm `fee_cents` becomes `null`.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/eventActions.ts "src/app/admin/locations/[locationId]/events/page.tsx" "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx"
git commit -m "Add event fee field, gated on the org having a Venmo handle set"
```

---

## Task 7: Registrant-facing payment UI

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`
- Modify: `src/app/events/registrations/page.tsx`

**Interfaces:**
- Consumes: `formatCents` from `@/lib/money`, `buildVenmoPaymentUrl` from `@/lib/venmoLink` (Task 2).

- [ ] **Step 1: Add fee/venmo data and a payment panel to the event detail page**

In `src/app/events/[eventId]/page.tsx`, add the import:

```ts
import { formatCents } from "@/lib/money";
import { buildVenmoPaymentUrl } from "@/lib/venmoLink";
```

Change the `event` select to add `fee_cents` and the org's `venmo_handle` (currently:
`"id, title, description, event_type, status, capacity, registration_mode, team_formation, location:locations(id, name, timezone, organization:organizations(id, name)), event_sessions(id, start_time, end_time, label, court:courts(name))"`):

```ts
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, status, capacity, fee_cents, registration_mode, team_formation, location:locations(id, name, timezone, organization:organizations(id, name, venmo_handle)), event_sessions(id, start_time, end_time, label, court:courts(name))"
    )
    .eq("id", eventId)
    .neq("status", "draft")
    .single();
```

Change both `myRegistration`-populating selects (currently `.select("id, status")`, appearing twice — once for the individual-registration lookup, once for the team-registration lookup) to `.select("id, status, payment_status")`.

Update the `myRegistration` type annotation:

```ts
  let myRegistration: { id: string; status: string; payment_status: string } | null = null;
```

After the existing `const org = location ? ... : null;` line, add:

```ts
  const venmoHandle = org?.venmo_handle ?? null;
```

Replace the `alreadyRegistered` branch of the render (currently a single `<p>` showing "Your team, X, is registered."/"You're registered."/"You're on the waitlist.") with:

```tsx
          ) : alreadyRegistered ? (
            <>
              <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
                {myTeamName
                  ? `Your team, ${myTeamName}, is ${myRegistration?.status === "waitlisted" ? "on the waitlist" : "registered"}.`
                  : myRegistration?.status === "waitlisted"
                    ? "You're on the waitlist."
                    : "You're registered."}
              </p>
              {myRegistration?.payment_status === "pending" && event.fee_cents && venmoHandle && (
                <div className="mt-2 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-900 dark:bg-yellow-950">
                  <p className="text-yellow-800 dark:text-yellow-300">
                    Payment due: {formatCents(event.fee_cents)} to @{venmoHandle}
                  </p>
                  <a
                    href={buildVenmoPaymentUrl({
                      handle: venmoHandle,
                      amountCents: event.fee_cents,
                      note: `${event.title} — ${myTeamName ?? profileName ?? "Registration"}`,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-yellow-800 underline dark:text-yellow-300"
                  >
                    Pay with Venmo
                  </a>
                </div>
              )}
              {myRegistration?.payment_status === "paid" && (
                <p className="mt-2 text-sm text-green-700 dark:text-green-400">Paid ✓</p>
              )}
              {myRegistration?.payment_status === "refunded" && (
                <p className="mt-2 text-sm text-gray-600 dark:text-neutral-400">Refunded</p>
              )}
            </>
          ) : profileIncomplete ? (
```

- [ ] **Step 2: Add fee/venmo data and a payment panel to "My Events"**

In `src/app/events/registrations/page.tsx`, add the import:

```ts
import { formatCents } from "@/lib/money";
import { buildVenmoPaymentUrl } from "@/lib/venmoLink";
```

After the existing `if (!user) { redirect(...); }` check, fetch the caller's own name once (used as the payment-note fallback for individual registrations):

```ts
  const { data: profile } = await supabase.from("users").select("name").eq("id", user.id).maybeSingle();
  const myName = profile?.name ?? null;
```

Change the `individualRegs` select (currently
`"id, status, event:events(id, title, event_type, location:locations(timezone), event_sessions(start_time))"`) to:

```ts
      "id, status, payment_status, event:events(id, title, event_type, fee_cents, location:locations(timezone, organization:organizations(venmo_handle)), event_sessions(start_time))"
```

Change the `teamRegs` select the same way (currently
`"id, status, team:event_teams(id, name), event:events(id, title, event_type, location:locations(timezone), event_sessions(start_time))"`) to:

```ts
      "id, status, payment_status, team:event_teams(id, name), event:events(id, title, event_type, fee_cents, location:locations(timezone, organization:organizations(venmo_handle)), event_sessions(start_time))"
```

In the row-rendering `.map((row) => { ... })`, right after the existing `const timezone = location?.timezone ?? "UTC";` line, add:

```ts
          const org = location ? (Array.isArray(location.organization) ? location.organization[0] : location.organization) : null;
          const registrantLabel = row.team?.name ?? myName ?? "Registration";
```

In the row's `<div className="flex flex-col items-end gap-2">` block, right after the existing status `<span>` and before the `cancelEventRegistration` `<form>`, add:

```tsx
                {row.payment_status === "pending" && event.fee_cents && org?.venmo_handle && (
                  <div className="text-right">
                    <p className="text-xs text-yellow-800 dark:text-yellow-300">
                      {formatCents(event.fee_cents)} due to @{org.venmo_handle}
                    </p>
                    <a
                      href={buildVenmoPaymentUrl({
                        handle: org.venmo_handle,
                        amountCents: event.fee_cents,
                        note: `${event.title} — ${registrantLabel}`,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-yellow-800 underline dark:text-yellow-300"
                    >
                      Pay with Venmo
                    </a>
                  </div>
                )}
                {row.payment_status === "paid" && (
                  <span className="text-xs text-green-700 dark:text-green-400">Paid ✓</span>
                )}
                {row.payment_status === "refunded" && (
                  <span className="text-xs text-gray-600 dark:text-neutral-400">Refunded</span>
                )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Manual verification**

With an org's Venmo handle set and an event with a $25.00 fee (from Task 6), register for it as a test player. Confirm the event detail page shows the "Payment due: $25.00 to @handle" panel with a working "Pay with Venmo" link (opens `https://venmo.com/?txn=pay&recipients=...` with the amount and note prefilled — verify the URL directly, e.g. via the browser's link-copy, since actually completing a Venmo payment isn't part of this verification). Confirm "My Events" shows the same payment-due information for that registration. Directly update that registration's `payment_status` to `'paid'` in the database and reload both pages; confirm both now show "Paid ✓" instead of the payment panel. Update it to `'refunded'` and confirm both show "Refunded".

- [ ] **Step 5: Commit**

```bash
git add "src/app/events/[eventId]/page.tsx" src/app/events/registrations/page.tsx
git commit -m "Show payment status and a Pay with Venmo link on registrant-facing pages"
```

---

## Task 8: Admin Registrants & Payments section

**Files:**
- Modify: `src/app/admin/eventActions.ts`
- Modify: `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `buildPaymentConfirmationEmail`, `sendEmail` from `@/lib/email` (Task 3); `getAppUrl` from `@/lib/appUrl`; `formatCents` from `@/lib/money` (Task 2); `event.fee_cents` already selected on this page (Task 6).
- Produces: `markRegistrationPaid(formData: FormData)`, `markRegistrationRefunded(formData: FormData)` server actions.

- [ ] **Step 1: Add `markRegistrationPaid` and `markRegistrationRefunded`**

Add to `src/app/admin/eventActions.ts`, at the end of the file. Add these imports at the top alongside the existing ones:

```ts
import { buildPaymentConfirmationEmail, sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/appUrl";
```

```ts
export async function markRegistrationPaid(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("event_registrations")
    .update({ payment_status: "paid" })
    .eq("id", registrationId)
    .eq("payment_status", "pending")
    .select("id, display_name, team:event_teams(name), event:events(id, title, fee_cents)");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?payment_error=${encodeURIComponent("Couldn't mark that registration paid.")}`
    );
  }

  const registration = updated[0];
  const event = Array.isArray(registration.event) ? registration.event[0] : registration.event;
  const team = Array.isArray(registration.team) ? registration.team[0] : registration.team;

  if (event?.fee_cents) {
    const { data: notify } = await supabase.rpc("get_registration_notification_email", {
      p_registration_id: registrationId,
    });
    const email = notify?.[0]?.email;
    if (email) {
      await sendEmail(
        email,
        buildPaymentConfirmationEmail({
          eventTitle: event.title,
          amountCents: event.fee_cents,
          registrantLabel: team?.name ?? registration.display_name ?? "Registration",
          eventUrl: `${getAppUrl()}/events/${event.id}`,
        })
      );
    }
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/registrations`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?payment_marked=1`);
}

export async function markRegistrationRefunded(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("event_registrations")
    .update({ payment_status: "refunded" })
    .eq("id", registrationId)
    .eq("payment_status", "paid")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?payment_error=${encodeURIComponent("Couldn't mark that registration refunded.")}`
    );
  }

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/registrations`);
  redirect(`/admin/locations/${locationId}/events/${eventId}?payment_marked=1`);
}
```

- [ ] **Step 2: Add the Registrants & Payments section to the admin event page**

In `src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`, add to the existing `eventActions` import:

```ts
import {
  updateEvent,
  addEventSession,
  removeEventSession,
  markRegistrationPaid,
  markRegistrationRefunded,
} from "@/app/admin/eventActions";
```

Add the import:

```ts
import { formatCents } from "@/lib/money";
```

Add `payment_marked` and `payment_error` to the `searchParams` type and destructure them alongside the existing params.

Add this query after the existing `sessions` query:

```ts
  const { data: registrations } =
    event.fee_cents
      ? await supabase
          .from("event_registrations")
          .select("id, payment_status, display_name, team:event_teams(name)")
          .eq("event_id", eventId)
          .neq("status", "cancelled")
          .order("registered_at")
      : { data: null };
```

Add the section at the end of the page, right before the closing `</div>` (after the existing "Assemble Teams" block):

```tsx
      {event.fee_cents && (
        <>
          <h2 className="mt-10 text-lg font-medium">Registrants &amp; Payments</h2>
          <p className="text-sm text-gray-600 dark:text-neutral-400">Fee: {formatCents(event.fee_cents)}</p>
          {payment_marked && <SuccessBanner>Payment status updated.</SuccessBanner>}
          {payment_error && (
            <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {payment_error}
            </p>
          )}
          {(!registrations || registrations.length === 0) && (
            <p className="mt-1 text-sm text-gray-600">No registrants yet.</p>
          )}
          <ul className="mt-4 flex flex-col gap-2">
            {(registrations ?? []).map((reg) => {
              const team = Array.isArray(reg.team) ? reg.team[0] : reg.team;
              const name = team?.name ?? reg.display_name ?? "Registrant";
              return (
                <li
                  key={reg.id}
                  className="flex items-center justify-between rounded border border-gray-300 px-4 py-2 dark:border-neutral-800"
                >
                  <span className="text-sm">{name}</span>
                  <span className="flex items-center gap-3">
                    <span
                      className={
                        reg.payment_status === "paid"
                          ? "rounded bg-green-50 px-2 py-1 text-xs text-green-800 dark:bg-green-950 dark:text-green-300"
                          : reg.payment_status === "refunded"
                            ? "rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
                            : "rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                      }
                    >
                      {reg.payment_status === "paid"
                        ? "Paid"
                        : reg.payment_status === "refunded"
                          ? "Refunded"
                          : "Pending"}
                    </span>
                    {reg.payment_status === "pending" && (
                      <form action={markRegistrationPaid}>
                        <input type="hidden" name="registration_id" value={reg.id} />
                        <input type="hidden" name="event_id" value={event.id} />
                        <input type="hidden" name="location_id" value={locationId} />
                        <button type="submit" className="text-xs underline">
                          Mark Paid
                        </button>
                      </form>
                    )}
                    {reg.payment_status === "paid" && (
                      <form action={markRegistrationRefunded}>
                        <input type="hidden" name="registration_id" value={reg.id} />
                        <input type="hidden" name="event_id" value={event.id} />
                        <input type="hidden" name="location_id" value={locationId} />
                        <button type="submit" className="text-xs text-red-700 underline dark:text-red-400">
                          Mark Refunded
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test changes in this task, but confirms nothing broke).

- [ ] **Step 5: Manual verification**

On an event with a $25.00 fee and at least one `pending` registration (from Task 7's verification), open the admin event page as an org member; confirm the new "Registrants & Payments" section lists that registration as "Pending" with a "Mark Paid" button. Click it; confirm the banner appears, the status becomes "Paid," a "Mark Refunded" button now shows instead, and (if `RESEND_API_KEY` is set) the registrant receives a payment-confirmation email, or (if not set) the console logs the no-op warning — matching the existing booking-email verification pattern. Reload the event detail page and "My Events" as that registrant; confirm both now show "Paid ✓" instead of the payment-due panel (this closes the loop with Task 7's verification). Click "Mark Refunded"; confirm the status becomes "Refunded" and no email is sent for that step. Confirm a `staff`-role member of the org can also see and use both buttons (per the "any org member" decision), and confirm a plain player cannot reach this page at all (existing admin-layout gating, unchanged by this plan).

- [ ] **Step 6: Role-impersonation RLS check**

Using a real session + PostgREST (not a superuser `psql` connection — see the process note in `docs/STATUS.md` about why), confirm a plain player who is not an org member for this event cannot PATCH another registration's `payment_status` directly (the existing `event_registrations` update policy's `with check (is_org_member(...) or status = 'cancelled')` should reject it with zero rows affected, the same way it already protects `status`).

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/eventActions.ts "src/app/admin/locations/[locationId]/events/[eventId]/page.tsx"
git commit -m "Add admin Registrants & Payments section with mark paid/refunded actions"
```

---

## Final Check

- [ ] Re-read `docs/superpowers/specs/2026-09-05-venmo-manual-payments-design.md` top to bottom and confirm every section has a corresponding task above: data model (Task 1), registration flow (Task 4), registrant-facing UI (Task 7), admin-facing UI (Tasks 5, 6, 8), payment-confirmation email (Tasks 3, 8), testing plan (Tasks 2, 3), manual verification plan (spread across Tasks 4-8's verification steps).
- [ ] Update `docs/STATUS.md` with a new entry describing what shipped, following this project's established log style (what changed, why, what was verified) — see any recent entry in that file for the expected shape and level of detail.
