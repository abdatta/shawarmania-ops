## Context

`ui-billing-counter` built a fast pay-now cart, but the real workflow also needs
mutable unpaid orders, later payment, customer recognition, history, voids, and
exception recovery. The database/customer contracts from #32/#33 land first so
new mocks can remain typed from generated schema types. This change still makes
no real read or write and promotes no live gate.

## Goals / Non-Goals

**Goals:**

- Preserve the current fast direct-payment path.
- Make the complete unpaid-order lifecycle walkable on the originating tablet.
- Give counter and admin contexts only the history/recovery information they need.
- Define adapter shapes that #10 can swap to real implementations unchanged.

**Non-Goals:**

- Supabase calls, local durability, synchronization, or gate promotion.
- Multiple active devices, partial payment, profile editing, or emergency billing.
- Printing, GST, digital sharing, or tablet attendance.

## Decisions

### Keep one composer with two terminal actions

The current cart remains the composition surface. “Pay now” opens the single-
method payment action and creates a paid result; “Save unpaid” creates an order
and clears the composer. Requiring every sale to pass through a saved order was
rejected because it adds steps to the common upfront-payment path.

### Open orders are a device workspace, not outlet history

Counter navigation gains Open orders and My shift. Open orders lists only orders
owned by the current device, with status, age, customer label, and total. Any
eligible operator authenticated on that device may reopen, edit, pay, or cancel.
The order creator remains visible separately from the current actor.

Showing every outlet order on the counter was rejected because launch owns an
order to one device and a shared tablet should not expose outlet-wide takings.

### Use optimistic version refusal even on one device

Every edit carries the version read. A stale save stops, explains that the order
changed, and reloads before the operator reapplies changes. This protects two
tabs and prepares the UI for later multi-device work without enabling it.

Silent field-level merging was rejected because quantity/payment conflicts can
change money without a person noticing.

### Customer lookup is exact, prompted, and form-local

The adapter receives a complete normalized phone only. A match opens a compact
confirmation showing saved details. If the form already differs, the prompt
states which form fields will be replaced. Accepting changes the current form;
declining leaves it untouched. Saving a new phone auto-creates the profile
through the eventual adapter. Existing profiles are never updated here.

Prefix/typeahead search was rejected because it enumerates global PII. Automatic
overwrite on match was rejected because a mistyped phone could silently replace
the active customer's details.

### Separate counter history from administrative history

My shift shows only paid bills attributed to the current device shift and totals
by payment method. FA/SA history is a phone-oriented outlet surface with filters,
detail, void/replacement, quarantined attempts, and stranded-order recovery.
Device context never inherits broader history because an FA/SA operates it.

### Correction never mutates an accepted paid bill

A paid bill can be voided with a reason and re-rung. A quarantined local attempt
can open a correction form, but saving produces a new client UUID linked to the
original. Discard records actor/reason and removes it from actionable work without
erasing the trace. Unpaid orders use cancel, not hard delete.

### Expand the coherent demo day rather than add isolated fixtures

The shared demo store gains a global repeat customer, direct paid bill, unpaid
order paid after cutoff, cancelled order, late sync, quarantined attempt, and
stranded-device transfer. Revenue and drawer totals are updated so every owner,
cash, and history surface still reconciles.

## Risks / Trade-offs

- **Added actions slow the counter** → keep Pay now visually primary and preserve
  the existing two-tap payment sequence.
- **Dense exception UI overwhelms ordinary billing** → keep recovery/admin work
  out of the composer and show it only when relevant.
- **Demo types drift from later adapters** → derive row shapes from generated
  schema types and make adapters the only screen dependency.
- **Global customer prompt leaks PII over a shoulder** → reveal a match only
  after full phone entry and show only billing-useful fields.

## Migration Plan

Add adapter contracts and fixtures first, then update counter routes/components,
then manager history/recovery. Keep all gates demo-only. Rollback restores the
old composer and registry entries; no real or browser-persistent data migrates.

## Open Questions

None.
