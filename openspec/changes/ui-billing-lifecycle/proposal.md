# Proposal: UI Billing Lifecycle

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #6, #7, #9, #32, #33 · **Gate**: in demo mode a counter can take immediate payment or save, reopen, edit, pay, and cancel an unpaid order; customer autofill, history, correction, quarantine, and stranded-order recovery are walkable without touching Supabase.

## Why

The current counter demo assumes every order is paid immediately and omits the
history and correction surfaces promised by billing-live. Those screens must be
truthful against mocks before a live adapter can replace them.

## What Changes

- Add two terminal actions: pay now, or save as unpaid.
- Add an originating-device open-order list with edit, pay, and cancellation flows.
- Show an order reference until payment and a pending reference until the server
  assigns the official bill number.
- Add exact-phone customer lookup and prompted autofill; accepting a conflict
  replaces only the current form and never edits the saved profile.
- Add current-device shift history and payment totals, plus FA/SA outlet history,
  void/replacement, rejected-entry correction, and stranded-order recovery surfaces.
- Represent offline, late-sync, conflict, and quarantine states in typed adapters
  and the demo scenario.
- Keep every new surface `demo`-gated and backed only by mocks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `counter-billing`: The counter UI gains unpaid-order, customer lookup,
  history, correction, and recovery behavior while preserving immediate payment.
- `demo-mode`: The two-outlet scenario includes the complete order-to-bill lifecycle.
- `app-shell`: Billing-device navigation exposes only counter-context surfaces.

## Impact

Counter and manager routes, feature registry, adapter types, mock fixtures,
domain-state tests, and tablet/phone E2E flows change. No real adapter,
migration, RLS policy, or gate promotion ships here.

## Non-goals

- Real persistence or synchronization.
- Partial payments, deposits, split tenders, printing, GST, or digital sharing.
- Editing saved global customer details.
- Billing-device attendance or emergency personal-device billing.

## Docs to update before archive

`docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md`, and
`docs/LIMITATIONS.md`.
