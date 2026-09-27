# Design: the-pipeline-asks-only-for-the-pipeline

## The query

`readOrders(outletId, pipelineOnly)` in
[`src/data-access/supabase-adapters/billing.ts`](../../../src/data-access/supabase-adapters/billing.ts)
gains one `.or(…)` when `pipelineOnly` is set. Everything else — the select
shape, the outlet filter, the ordering, the projection, the cache — is
untouched.

```
status.eq.open,and(status.eq.paid,prepared_at.is.null)[,id.in.(<envelope order ids>)]
```

PostgREST ANDs a top-level `.or()` with the existing `.eq('outlet_id', …)`, so
outlet scoping is unchanged and still enforced underneath by RLS.

The client-side `orders.filter(… inPipeline …)` **stays**. It is no longer
load-bearing for the server's rows, but it is still what decides the projected
result after the overlay — an order fetched only because an envelope names it
must still be dropped if the overlay leaves it prepared and paid. Removing it
would be the actual behaviour change.

## Why envelope ids have to be in the query

This is the whole risk of the change, and it is not obvious.

`projectOrders` overlays undelivered commands onto the fetched rows. Every
overlay but `create_order` is guarded:

```js
const current = overlaid.get(envelope.command.payload.orderId)
if (current) { … }
```

So an overlay can only modify a row the query returned. Today the query returns
every `open` or `paid` order, so that guard almost never bites. Narrow the query
and two commands break:

| Command | Server row | Overlay should | Without envelope ids |
|---|---|---|---|
| `void_order_payment` | `paid`, `prepared_at` set — excluded | reopen it to `open`, back on the rail | no-op; card never returns |
| `set_order_preparation(false)` | `paid`, `prepared_at` set — excluded | clear preparation, back on the rail | no-op; card never returns |

Both are real: a biller takes back a payment recorded against an order whose
food already went out. `offline-billing-resumption` requires *take a payment
back* to survive a cold start, and `counter-billing` requires the card to be on
the rail whenever the order is not both prepared and paid. A filter that skips
this is a correctness regression wearing a performance fix's clothes.

`projectableEnvelopes(outletId)` is already read **before** the query is built —
the existing comment explains that ordering is deliberate — so the ids are in
hand at no extra cost.

`create_order` needs no help: it `set`s unconditionally, and its id will not
exist on the server yet. Including it in `id.in.(…)` is harmless.

## The URL-length fallback

A uuid costs 37 characters in the query string. A deep offline stretch could
accumulate enough envelopes to push the request past the gateway's URI limit,
and a 414 would break the pipeline outright — a far worse failure than the
egress it saves.

Above `ENVELOPE_ID_QUERY_LIMIT` (100) pending order ids, the read falls back to
`status in ('open','paid')` — the read this change replaces, and deliberately
not an unfiltered one, so a tablet that deep offline pays yesterday's price
rather than more than it. Correctness first: the rare deep-offline tablet pays
the old egress, every other read pays almost none. The threshold is a named
constant with the reasoning beside it, not a literal.

## Rejected alternatives

**A `business_date` or `ordered_at` floor.** The tempting second guard, and
wrong. `counter-billing` is explicit that an order leaves the list only when it
is both prepared and paid; a date floor removes it for a different reason and
hides food still owed. It would also have to key off the *open shift's* business
date rather than `current_date`, because a shift here runs past the 4am
rollover — extra machinery to implement a behaviour the contract forbids.
Production holds zero stale unprepared orders, so it guards nothing today.

**Two queries — the pipeline predicate, then the envelope ids.** Avoids the URL
length worry and costs a second round trip on every refresh, including the
overwhelming majority with an empty outbox. The fallback above buys the same
safety for nothing.

**Fetching ids only, then hydrating.** Halves nothing: the hydration carries the
same nested payload. It only adds a round trip.

**Deleting `inPipeline` now that the server filters.** See above — it still
decides the post-overlay result. Keeping it also means the mock adapter and the
real adapter continue to agree.

**Marking old paid orders `prepared` in a backfill.** Changes production
records to make a query cheaper. The data is not wrong; the query is.

## RLS, money, offline

- **RLS** — no policy changes. `.or()` narrows *within* what policy already
  allows; `orders` is outlet-scoped and its existing isolation tests continue to
  cover it. Narrowing a client query can never widen what a tablet can read.
- **Money** — none touched. No total, no paise arithmetic, no bill row.
- **Offline** — the substance of this change. Covered above and pinned by tests
  in `tasks.md`; the outbox, the envelope chain and the resume record are
  otherwise untouched.

## Test surface

The existing fakes in
[`billing.test.ts`](../../../src/data-access/supabase-adapters/billing.test.ts)
(`offlineClient`, `emptyReadableClient`, and the history fakes) are hand-rolled
query builders with no `.or`. They need one, or every read through them throws
`query.or is not a function` — which is itself a useful signal that the new call
is on the path it should be.

The regression guard is a **recording client** that captures the `.or()`
argument, so a future edit that quietly drops the filter fails a test rather
than a billing cycle.
