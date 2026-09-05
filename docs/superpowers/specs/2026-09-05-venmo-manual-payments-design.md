# Manual Venmo Payments for Event Registration — Design Spec

Status: approved as spec — ready for an implementation plan
Date: 2026-09-05

## Goal

Let an org charge a registration fee for a private tournament/event and
collect it via Venmo, with a clean way to track who's paid. Venmo has no
public API for confirming a P2P payment automatically, so this is a
**manual-confirmation** flow: a registrant sees payment instructions
(including a prefilled Venmo deep link) after registering, and an org
member marks the registration paid once they've checked their own Venmo
activity. This is explicitly a stopgap for small/private events, not a
replacement for real payment processing — v4 (Stripe Connect) remains
the path for a public marketplace with automated, non-manual payment.

`event_registrations.payment_status` (`not_required` / `pending` / `paid`
/ `refunded`) has existed, unused, since the registration plan shipped
(`docs/superpowers/plans/2026-08-31-special-events-registration.md`) —
this spec is the first thing to actually read or write it.

## Non-goals

- **No real payment processing.** No card numbers, no PCI scope, no
  webhook, no automated confirmation. Venmo's P2P transfer has no public
  API for this; the only automated alternative (PayPal/Braintree's "Pay
  with Venmo" checkout button) requires an approved business merchant
  account and is real payment processing under the hood — that's
  Stripe-Connect-adjacent effort, out of scope here.
- **No per-player team fees.** One flat `fee_cents` per event, charged
  once per registration (individual or team) regardless of roster size —
  matches how capacity already treats a team registration as one unit.
- **No payment deadlines or auto-expiry.** A `pending` registration holds
  its capacity spot exactly like a `paid` one, indefinitely. If a no-pay
  becomes a problem, the org cancels that registration manually (existing
  `cancelEventRegistration` flow) the same way they'd handle any other
  no-show today. No background job runner exists in this app yet, and
  building one is a much bigger addition than this feature warrants.
- **No refund payment processing.** "Mark refunded" only flips
  `payment_status` for bookkeeping — the org still sends the actual Venmo
  refund themselves, outside the app.
- **No multiple payment methods.** Venmo only. A generic
  "payment_instructions text field" was considered and rejected — the
  user specifically wants Venmo, and a structured handle enables the
  deep-link button; free text would not.
- **No org-level payment history/reporting.** Just per-registration
  status, visible on the existing admin event page.

## Data model

```sql
-- Nullable, no backfill -- same pattern as every other optional column
-- added to these tables (courts.notes, locations.city, etc.).
alter table organizations add column venmo_handle text;
alter table events add column fee_cents integer;
```

`fee_cents` null or `0` means free — today's behavior for every existing
event, completely unaffected. No RLS changes: `organizations update
admin` and the existing `events` insert/update policies (`is_org_admin`
for locations/courts-adjacent writes; events themselves already use
`is_org_member`, unchanged by this spec) already cover who can set these.

No schema change needed on `event_registrations` — `payment_status`
already exists with exactly the four values this spec needs.

## Registration flow

`registerForEvent` (`src/app/actions/events.ts`) already fetches the
event row before deciding registration status; add `fee_cents` to that
select. At the final insert, set:

```ts
payment_status: initialPaymentStatus(event.fee_cents),
```

`initialPaymentStatus(feeCents: number | null): "pending" | "not_required"`
is a new pure function alongside `determineRegistrationStatus` in
`src/lib/eventRegistration.ts` — trivial, but built test-first for
consistency with everything else in that file. Nothing else about
`registerForEvent` changes. Capacity/waitlist logic
(`determineRegistrationStatus`, the `event_registration_counts` view,
`promote_next_waitlisted`) is untouched — a `pending` registration counts
toward `registered` exactly like a `paid` one, per the non-goal above.

## Registrant-facing UI

Both the event detail page (`src/app/events/[eventId]/page.tsx`) and "My
Events" (`src/app/events/registrations/page.tsx`) already query the
caller's own registration(s); both add `payment_status` to their selects
and, for any row with `payment_status = 'pending'`, show a payment-due
panel:

- The amount (formatted from cents to dollars) and the org's Venmo
  handle, as plain text.
- A "Pay with Venmo" link/button built by a new pure `buildVenmoPaymentUrl
  ({ handle, amountCents, note })` (`src/lib/venmoLink.ts`, built
  test-first) using Venmo's `https://venmo.com/?txn=pay&recipients=
  {handle}&amount={dollars}&note={note}` link pattern — opens the Venmo
  app (or venmo.com) with the amount and a note prefilled. The note is
  `"{event title} — {team name}"` for a team registration or `"{event
  title} — {registrant's display name}"` for an individual one, so the
  org can match an incoming Venmo payment back to the right registration
  without opening the app. **This is an unofficial but
  long-stable deep-link convention, not a documented Venmo partner API**
  — the plain handle+amount text is always shown alongside it, so a
  future change to Venmo's link format degrades to "here's who to pay,"
  never to nothing.
- Once `payment_status = 'paid'`, the panel becomes a plain "Paid ✓"
  badge instead. `'refunded'` shows a plain "Refunded" label (registrant
  view only matters post-cancellation, so no action needed there).

## Admin-facing UI

**Org Venmo handle** — new field on `/admin` (`src/app/admin/page.tsx`),
owner/admin only, alongside a new "Edit club settings" disclosure (same
pattern as the existing "Edit location"/"Edit court" ones elsewhere).
Backed by a new `updateOrganization` action in `src/app/admin/actions.ts`.

**Event fee** — `eventFieldsFromFormData` (`src/app/admin/eventActions.ts`)
gains a `fee_cents` field, entered in the form as a dollar amount and
converted to integer cents server-side (avoids float rounding). The
create/edit event forms only let a fee be entered when the org's
`venmo_handle` is already set; otherwise that part of the form is
replaced with a note pointing to `/admin` to set one first — a paid event
can never exist with no way to actually collect payment.

**Registrants & Payments** — new section on the admin event detail page
(`src/app/admin/locations/[locationId]/events/[eventId]/page.tsx`),
shown only when the event has a fee. Lists every active (non-cancelled)
registration — individual display name or team name — with a
payment-status badge and, depending on current status, a "Mark Paid" or
"Mark Refunded" button. This is a new list; today's page only queries
*ungrouped individual registrants* for admin-assembled team assembly, not
a general registrant roster. Two new actions, `markRegistrationPaid` and
`markRegistrationRefunded` (`src/app/admin/eventActions.ts`):

- `markRegistrationPaid`: sets `payment_status = 'paid'` where it's
  currently `'pending'`; sends the payment-confirmation email (below);
  zero-rows-affected check, matching this codebase's established
  "don't silently claim success" convention.
- `markRegistrationRefunded`: sets `payment_status = 'refunded'` where
  it's currently `'paid'`. Not gated on the registration's own `status`
  (`registered`/`waitlisted`/`cancelled`) — refunding is a separate
  bookkeeping action an org might reasonably take on a still-active
  registration too (e.g. correcting a mistake), not only a cancelled one.
  No email — a cancellation, when there is one, already happened through
  the existing flow by the time this is relevant.

No RLS changes needed for either: `event_registrations`' existing update
policy (`is_org_member(...) or status = 'cancelled'` in the `with check`)
already lets any org member write arbitrary fields — including
`payment_status` — on a registration for their own event. Matches the
"any org member, staff included" decision.

## Payment-confirmation email

New `buildPaymentConfirmationEmail` in `src/lib/email.ts` (test-first,
same shape as `buildBookingConfirmationEmail`), sent by
`markRegistrationPaid` via the existing `sendEmail` wrapper. Needs the
registrant's email under RLS that doesn't otherwise expose it to an org
member — same class of gap `get_booking_notification_email`
(`0026_booking_notification_email.sql`) already exists to solve. New
narrow `security definer` RPC, `get_registration_notification_email
(p_registration_id)`, gated by the same "is this an org member for this
registration's event" condition the update policy already uses:

- Individual registration → that row's own `user_id`.
- Team registration → the team's `captain_user_id` (the captain is the
  one who pays, per the flat-fee decision).

A send failure is caught and logged, never blocks the mark-paid action
itself — same pattern as the existing booking emails.

## Testing plan

- `buildVenmoPaymentUrl` — unit-tested test-first: handle/amount/note
  encoding (spaces, special characters), a zero/missing amount, output
  URL shape.
- `initialPaymentStatus` — unit-tested test-first: `null`, `0`, and a
  positive `fee_cents` value.
- `buildPaymentConfirmationEmail` — unit-tested test-first, same
  structure as the existing email-builder tests.
- No new tests for the server actions themselves (`registerForEvent`
  changes, `updateOrganization`, `markRegistrationPaid`,
  `markRegistrationRefunded`) or page components — consistent with this
  codebase's convention of verifying server actions live rather than
  unit-testing them.

## Manual verification plan

- Apply the migration; confirm a fee-less event still registers with
  `payment_status = 'not_required'`, unchanged from today.
- Set an org's Venmo handle from `/admin`; confirm a fee field becomes
  available on that org's event create/edit forms, and confirm it's
  absent/blocked before the handle is set.
- Create a paid event; register for it as a player; confirm the
  payment-due panel appears on both the event detail page and "My
  Events," the Venmo deep link opens with the right amount/note
  prefilled, and the plain-text handle+amount is always visible too.
- As an org member, open the new Registrants & Payments section; confirm
  the new registration shows `pending`; click "Mark Paid"; confirm the
  registrant's view flips to "Paid ✓" and a confirmation email is
  received (or logged as a no-op if `RESEND_API_KEY` isn't set locally,
  matching the existing booking-email verification pattern).
- Cancel that (now paid) registration through the existing cancellation
  flow, then click "Mark Refunded"; confirm the status updates and no
  email is sent for that step.
- Confirm a `staff`-role member (not just owner/admin) can mark a
  registration paid/refunded, per the "any org member" decision — and
  cannot edit the org's Venmo handle (owner/admin only).
- Role-impersonation check via a real session + PostgREST (not a
  superuser `psql` connection, per the lesson logged earlier in
  `docs/STATUS.md`): confirm a plain player cannot PATCH their own
  registration's `payment_status` to `'paid'` directly.
