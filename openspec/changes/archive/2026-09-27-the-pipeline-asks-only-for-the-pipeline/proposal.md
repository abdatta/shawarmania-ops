# Proposal: the-pipeline-asks-only-for-the-pipeline

> **Model**: Opus · **Kind**: production correction, not a roadmap change ·
> **Gate**: the counter's pipeline read asks the server for the orders the
> pipeline shows and for nothing else; the rail lists exactly the orders it
> listed before, including a paid-and-prepared order that a pending local
> unwind reopens; and the measured order egress for one refresh falls from
> every order the outlet has ever sold to the handful still owed.

## Why

**The counter downloads every order the outlet has ever sold, about 1,300 times
a day, and throws almost all of it away.**

Measured against production on 2026-09-21:

| | |
|---|---|
| Orders returned by one pipeline refresh | **1,917** |
| Orders the screen keeps | **0** |
| JSON on the wire per refresh | ~2.8 MB raw |
| Refreshes in 24h | 1,306 |
| PostgREST egress, 20 Sep | **289.5 MB — 99.2% of that day's total** |

The project sits on Supabase's free plan with a 5 GB monthly egress allowance
and a 51 MB database. It burned 2.75 GB in one billing cycle. Nothing about the
shape of the business explains that: seven monthly active users, no storage, and
realtime accounting for 0.7% of it.

**The cause is a filter on the wrong side of the network.** `readOrders` asks
for `status in ('open','paid')`, and `paid` is terminal — an order settled in
July is still `paid` today, so it comes back down the wire with its line items,
its discounts and two profile joins, on every refresh, forever. The screen then
applies the real predicate in JavaScript and discards the rest.

This gets worse on its own. Egress grows with the total number of orders ever
sold, so the chart climbs every week whatever the staff do.

## What changes

**Nothing a biller can see.** The same rows reach the screen; they simply stop
travelling to it only to be deleted.

The pipeline's read asks the database for what the pipeline holds — which
[`counter-billing`](../../specs/counter-billing/spec.md) already defines:

> The activity column SHALL present this outlet's unfinished work as **one
> list** … holding every order that is not yet both prepared and paid … An
> order SHALL leave the list only when it is both prepared and paid.

That is `status = 'open' OR (status = 'paid' AND prepared_at IS NULL)` — the
exact predicate the client already computes.

**And the orders a pending offline command is about.** This is the part a naive
filter would break. An order that is paid *and* prepared has left the pipeline,
so the narrowed query would not fetch it — but a queued `void_order_payment` or
`set_order_preparation(false)` reopens it, and both overlays only apply to rows
already fetched. The read therefore also asks for every order id named by an
undelivered envelope, so an unwind still puts its card back on the rail. See
[`design.md`](design.md).

## What this is not

This does **not** bound the pipeline by date. A date floor was the obvious
second guard and it is wrong here: the contract says an order leaves the list
only when it is both prepared and paid, so dropping an old unprepared order
would hide food that is still owed. Production currently holds zero such
orders; if that ever changes, the right answer is to show them, not to age them
out. Recorded as a rejected alternative rather than left implicit.

## Non-goals

- **No contract change.** No spec delta: this change decides nothing new. It
  makes the implementation ask for what `counter-billing` already says the
  pipeline is, and the offline case it protects is already required by
  `offline-billing-resumption` (*take a payment back* survives a cold start) and
  `order-lifecycle` (the paid-order unwind commands).
- **No change to `billing_event_device_labels`.** Its row count falls with the
  id list it is handed, so it is fixed by this change without being touched. The
  separate question of snapshotting the label onto the order row is a schema
  change worth roughly 0.3 MB/day after this lands, and the owner and I agreed
  on 2026-09-21 to leave it. Filed under `openspec/todos/`.
- **No change to `readBills`, the menu read, or the outlets read.** They repeat
  work rather than over-fetch it, so fixing them means caching, which *can*
  change what a tablet sees and when. Separate change, separate reasoning.
- **No roadmap row.** A correction is not planned capability.

## Docs this updates before it can be archived

- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — one line on the rule
  this makes explicit: a list's read asks for the list, and a predicate the
  screen applies belongs in the query.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — where egress is read in
  the Supabase dashboard, and the per-endpoint log query that attributes it, so
  the next spike is diagnosed in minutes rather than rediscovered.
