# Proposal: UI Billing Lifecycle

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #6, #7, #9, #32, #33 · **Gate**: in demo mode a counter can take immediate payment with its brief guaranteed Undo, or save an order whose preparation items, customer and total stay visible, reopen it, edit it, pay it and cancel it; a manager can void a bill, the counter can manually re-ring its correction, and a manager can clear a stranded order; customer autofill and shift history are walkable without touching Supabase.

## Why

The current counter demo assumes every order is paid the instant it is rung. The
real workflow records an order so the kitchen can cook it and takes the money on
handover, to a walk-in customer or to an
aggregator's rider. Those screens have to be truthful against mocks before a live
adapter replaces them.

## What Changes

- Add two terminal actions to the composer: primary Order for the ordinary
  prepare-then-handover flow, or secondary Mark Paid for the rarer upfront
  payment, opening exact tender capture while preserving the existing six-second
  guaranteed Undo before delivery.
- Put each saved order directly into Open orders, led by its complete preparation
  items, optional customer and total. Keep the daily order number as a small
  reference on that persistent card and remove the redundant one-slot latest-order
  card.
- Add a compact Open orders list owned by this tablet, with icon edit/cancel,
  preset cancellation reasons and a Mark Paid action.
- Make edit hand the saved order to the full composer, where menu items,
  quantities, customer name and phone all remain editable; temporarily suspend
  and then restore any new-order draft already in progress.
- On a landscape tablet, compose those three counter concerns into one fixed
  workspace: menu at left, current bill in the middle, and one continuous
  Open orders + this shift's bills rail at right. The narrower routes remain
  available where three touch-safe columns do not fit.
- Record one or several exact tender allocations, including mixed Cash + UPI and
  the aggregator methods used when a rider collects, through a tap-first modal.
- Add exact-phone customer lookup and prompted autofill; accepting a conflict
  changes only the current form and never edits the saved profile.
- Temporarily require either customer name or phone in the composer UI while
  leaving both database columns nullable so the trial can be reversed without a
  migration.
- Add this shift's history and payment totals for the counter, and an outlet
  history for managers with reasoned void and cancellation of a stranded order.
  Show all supported tender totals even when one is zero.
  Every closed bill expands to its immutable line names, quantities, captured
  prices, line totals, payment facts and optional customer snapshot.
  A corrected sale is manually re-rung on the enrolled counter tablet; no manager
  phone creates money or transfers a draft to the counter.
- Represent unsent, retrying and needs-attention states in typed adapters and in
  the demo scenario, in plain words. Correction or discard happens only on the
  originating tablet; manager diagnostics are read-only and non-identifying.
- Keep every new surface `demo`-gated and backed only by mocks.
- Retire Card and Other from every selectable payment-method surface and future
  plan, and remove both from the database enum through a guarded forward
  migration because production contains neither in bills or expenses. The
  supported set is deliberately finite: Cash, UPI, Swiggy and Zomato for bills;
  Cash and UPI for expenses.

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
shared command vocabulary, payment selectors, domain-state tests, and tablet and
phone E2E flows change. One forward migration replaces the payment enum only
after proving no unsupported rows exist and restores its dependent policy; no real
adapter or gate promotion ships here.

## Non-goals

- Real persistence or synchronisation.
- **Order transfer between tablets, and any recovery surface.** A stranded order
  is cancelled by a manager, which is an ordinary action on an ordinary list.
- **A version-conflict screen.** The only race is a manager cancelling an order
  the counter is paying, which is reported as a cancelled order, not a conflict.
- Discounts, deposits, partially paid orders, printing, GST or digital
  sharing. V1 carries `discount_paise = 0` without offering a discount control.
- Manager-side billing, automatic re-ring handoff or prefill, and manager mutation
  of a tablet's local delivery queue.
- Editing saved global customer details.
- Tablet attendance, or emergency billing from a personal device.

## Docs to update before archive

`docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md` and
`docs/LIMITATIONS.md`.
