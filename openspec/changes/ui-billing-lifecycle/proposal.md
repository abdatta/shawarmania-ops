# Proposal: UI Billing Lifecycle

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #6, #7, #9, #32, #33 · **Gate**: in demo mode a counter can take immediate payment with its brief guaranteed Undo, or save an order with a number that is called out, reopen it, edit it, pay it and cancel it; a manager can void a bill, the counter can manually re-ring its correction, and a manager can clear a stranded order; customer autofill and shift history are walkable without touching Supabase.

## Why

The current counter demo assumes every order is paid the instant it is rung. The
real workflow records an order so the kitchen can cook it, calls a number when the
food is ready, and takes the money on handover, to a walk-in customer or to an
aggregator's rider. Those screens have to be truthful against mocks before a live
adapter replaces them.

## What Changes

- Add two terminal actions to the composer: Pay now, preserving the existing
  six-second guaranteed Undo before delivery, or Save order.
- Show the daily order number prominently on save, and keep it visible until the
  order is paid or cancelled.
- Add an Open orders list owned by this tablet, with reopen, edit, pay and cancel.
- Pay an order through one method, including the aggregator methods used when a
  rider collects.
- Add exact-phone customer lookup and prompted autofill; accepting a conflict
  changes only the current form and never edits the saved profile.
- Add this shift's history and payment totals for the counter, and an outlet
  history for managers with reasoned void and cancellation of a stranded order.
  A corrected sale is manually re-rung on the enrolled counter tablet; no manager
  phone creates money or transfers a draft to the counter.
- Represent unsent, retrying and needs-attention states in typed adapters and in
  the demo scenario, in plain words. Correction or discard happens only on the
  originating tablet; manager diagnostics are read-only and non-identifying.
- Keep every new surface `demo`-gated and backed only by mocks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `counter-billing`: The counter UI gains orders, order numbers, customer lookup,
  shift history and manager correction, while preserving immediate payment.
- `demo-mode`: The two-outlet scenario includes the complete order-to-bill
  lifecycle, including an aggregator order collected by a rider.
- `app-shell`: Tablet navigation exposes only counter-context surfaces.

## Impact

Counter and manager routes, the feature registry, adapter types, mock fixtures,
domain-state tests, and tablet and phone E2E flows change. No real adapter,
migration, policy or gate promotion ships here.

## Non-goals

- Real persistence or synchronisation.
- **Order transfer between tablets, and any recovery surface.** A stranded order
  is cancelled by a manager, which is an ordinary action on an ordinary list.
- **A version-conflict screen.** The only race is a manager cancelling an order
  the counter is paying, which is reported as a cancelled order, not a conflict.
- Discounts, partial payments, deposits, split tenders, printing, GST or digital
  sharing. V1 carries `discount_paise = 0` without offering a discount control.
- Manager-side billing, automatic re-ring handoff or prefill, and manager mutation
  of a tablet's local delivery queue.
- Editing saved global customer details.
- Tablet attendance, or emergency billing from a personal device.

## Docs to update before archive

`docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md` and
`docs/LIMITATIONS.md`.
