## Context

`ui-billing-counter` built a fast pay-now cart. The real workflow also needs an
order that exists while the food is being made, a number to call the customer by,
payment on handover, customer recognition, shift history and manager correction.
The database and customer contracts from #32 and #33 land first, so new mocks stay
typed from generated schema types. This change makes no real read or write and
promotes no gate.

## Goals / Non-Goals

**Goals:**

- Preserve the fast direct-payment path exactly as it is.
- Make the full order lifecycle walkable on the tablet that took the order.
- Give counter and manager contexts only the history each needs.
- Define adapter shapes #10 can swap to real implementations unchanged.

**Non-Goals:**

- Supabase calls, local durability, synchronisation or gate promotion.
- Order transfer, recovery surfaces, version-conflict screens.
- Several tablets, partial payment, profile editing, printing or GST.

## Decisions

### One composer, two terminal actions

The current cart stays the composition surface. Pay now opens the single-method
payment action and creates a paid result. Save order creates an order and clears
the composer. Requiring every sale to pass through a saved order was rejected
because it adds steps to the common case where somebody pays at once.

### The order number is the loudest thing on the screen after saving

The number is what a person shouts across a counter, so on save it is the largest
element of the confirmation, and it stays on the order's row in Open orders. It is
styled unmistakably differently from a bill number, because the two live minutes
apart in the same workflow and a shop that confuses them will hand food to the
wrong person.

### Open orders are a tablet workspace, not outlet history

Counter navigation gains Open orders and My shift. Open orders lists only orders
this tablet owns, with number, age, customer label, items and total. Anyone
holding the tablet's live shift may reopen, edit, pay or cancel. The creator stays
visible separately from the current actor.

Showing every outlet order on the counter was rejected because a shared tablet
should not expose outlet-wide takings.

### An aggregator order is an ordinary order

Swiggy and Zomato work arrives on the aggregator's own device, gets rung into our
counter as an order so the kitchen has it, and is paid by that aggregator's
payment method when the rider collects. It needs no separate flow, no separate
list and no aggregator reference field, which the owner explicitly did not want.
The demo scenario carries one of these end to end so the path is walked, not
assumed.

### A cancelled order is reported as cancelled, not as a conflict

The only second writer an order can have is that outlet's manager cancelling it.
When a payment meets that, the counter says the order was cancelled and by whom,
and stops. The optimistic-version conflict screen from the original design is cut
along with the version contract behind it in #33.

### Counter history and manager history are different surfaces

My shift shows only paid bills from this tablet's current shift and totals by
payment method. The manager's history is a phone-oriented outlet surface with
filters, detail, void and re-ring, and the outlet's open orders with a cancel
action. Tablet context never inherits the wider history just because a manager
happens to be holding the shift.

### Correction never mutates an accepted paid bill

A paid bill is voided with a reason and re-rung as a new bill. A local command
that will never succeed reads as needing attention, and correcting it produces a
new client UUID linked to the original. Discard records who and why and leaves the
trace. Open orders are cancelled, never deleted.

### Plain words for every delivery state

Not sent yet, retrying, needs attention, sent, void, cancelled. No screen in this
change uses the words quarantine, envelope, idempotency or provisional. A biller
at 9pm has to know what to do next, and the state name is where that starts.

### Expand the coherent demo day rather than add isolated fixtures

The shared demo store gains a repeat customer found by phone, a direct paid bill,
an order taken and paid on handover, an aggregator order collected by a rider, a
cancelled order with a reason, an unsent bill, and one command needing attention.
Revenue and drawer totals are updated so every owner, cash and history surface
still reconciles.

## Risks / Trade-offs

- **Added actions slow the counter** → Pay now stays visually primary and keeps
  its existing two-tap sequence.
- **Two numbers confuse staff** → different shape, different size, different
  label, and only one of them is ever the identity of a given row at a given time.
- **Exception UI overwhelms ordinary billing** → correction and manager work stay
  out of the composer and appear only when relevant.
- **Demo types drift from later adapters** → row shapes derive from generated
  schema types and adapters remain the only screen dependency.
- **The customer prompt leaks a phone over a shoulder** → a match is revealed only
  after full phone entry, showing only billing-useful fields.

## Migration Plan

Add adapter contracts and fixtures first, then counter routes and components, then
manager history. Every gate stays demo-only. Rollback restores the old composer
and registry entries; no real or browser-persistent data migrates.

## Open Questions

None.
