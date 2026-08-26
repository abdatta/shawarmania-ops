# Design: Close the paid-order read race

## D1 — The defect is a torn read, not a lost write

Nothing is lost. The payment reached the server, the bill exists, the order row
says `paid`. What tore is the *composition*: `readOrders` builds one answer from
two reads taken at different instants, and the fact it is looking for migrates
between them.

Call the server snapshot **T1** and the outbox read **T2**, with `T1 < T2`
because they are sequential awaits. An accepted command performs a handoff: the
server row gains the fact and `recordResult` deletes the envelope, atomically
with respect to each other but not with respect to a reader sitting between T1
and T2.

| Accept lands | Server row at T1 | Envelope at T2 | Composed answer |
|---|---|---|---|
| before T1 | paid | gone | paid ✓ |
| **between T1 and T2** | **open** | **gone** | **open ✗** |
| after T2 | open | present | paid ✓ |

One row is wrong, and it is reachable in practice: `act()` calls `load()` the
instant a payment is committed locally, the drain fires on a 2 second tick, and
paying triggers a refresh ping-pong between the pipeline and the bill list
(`onActivityChanged` in each direction), so several reads straddle the tick. It
has to bite once in twenty-four payments to produce what production shows.

## D2 — Reversing the reads closes it, and the gap it opens is the harmless one

Read the outbox at T1 and the server at T2 and the same table inverts:

| Accept lands | Envelope at T1 | Server row at T2 | Composed answer |
|---|---|---|---|
| before T1 | gone | paid | paid ✓ |
| between T1 and T2 | present | paid | paid ✓ |
| after T2 | present | open | paid ✓ |

Every row is right, because the envelope is only ever deleted *after* the server
row is written, so reading the outbox earlier and the server later means at
least one of them always holds the fact. The current order reads them in the one
sequence that can miss both.

This is not free. It opens the mirror gap: a command **created** between T1 and
T2 is in neither read, so a brand-new order could be invisible for one frame.
Three reasons to accept it rather than engineer it away:

1. **The operator's own action is never in it.** `payOrder` and `createOrder`
   write their envelope and then call `load()`, so the outbox read at T1 always
   happens after the write it needs to see. The gap only catches a command from
   a second tab on the same tablet during an in-flight read.
2. **It self-heals on the next read**, and every mutation triggers one.
3. **The two failures are not equal.** Missing a new order for one frame shows
   less than the truth. Showing a paid order as unpaid shows something that is
   *false and actionable*, and the action costs a customer ₹480.

Stated here rather than fixed, so the next reader knows it was weighed.

## D3 — One projection, used by the screen and by the guard

The overlay is not payment-specific: it replays `create_order`, `revise_order`,
`set_order_preparation`, `pay_order`, `void_order_payment`, `cancel_paid_order`
and `cancel_order`. Reversing the reads moves all of them, so the loop becomes a
named function taking a server snapshot and the local envelopes and returning
what this tablet believes, rather than a block living inside `readOrders`.

That naming is what makes the second half of the fix possible. `payOrder` today
validates against `orderCache.get(orderId) ?? readOrder(orderId)`, and
`readOrder` reads the server row **with no overlay at all**. So the guard and
the screen would otherwise consult different truths, which is how the bug got
written in the first place. Both now call the same projection.

## D4 — The guard keys on projected state, never on history

The obvious guard, *refuse a payment for an order that already has a pay
command*, is wrong, and wrong in a way no existing test would catch.

`unpay_billing_order` deliberately returns a paid order to `open` inside the
five-minute window precisely so it can be paid again. The outbox already chains
several commands per order (`chainId` is the order id). A history-keyed guard
therefore breaks un-pay-then-repay at the counter, silently, while every test
stays green — the exact failure mode that keeps this change out of the quickfix
lane.

So the guard asks the projection, not the log: **refuse only when the order
currently projects to `paid` or `cancelled`.** After an accepted
`void_order_payment` the projection is `open` again and the repay proceeds. This
also gives a better message than the server's: the tablet says the order is
already paid, in place, instead of the operator discovering it seconds later as
a red refusal on somebody else's screen.

## D5 — Why not make the handoff atomic, which would be the real fix

The structural cure is to stop deleting the envelope at the moment of accept:
mark it `delivered` and prune it once the server read is known to carry it, for
instance against the `watermark` already on `billing_commands`. Then no reader
can sit in a gap, in either direction, and D2's mirror gap disappears too.

Not done here, deliberately:

- It adds an envelope state and therefore a Dexie schema version, on the
  offline path, in a bug fix.
- It needs a pruning policy. Get it wrong in the safe direction and IndexedDB
  grows without bound on a tablet; wrong in the other and the bug returns.

The related option, consulting `database.results` in the read path, was also
rejected. Results **are never pruned** — nothing in `store.ts`, `schema.ts` or
`drain.ts` deletes them — so replaying them on every read is unbounded work on
the hot path, growing at roughly a hundred rows a trading day, and merging them
causally with live envelopes reproduces the ordering problem it was meant to
avoid. D2 achieves the same correctness by ordering two reads.

## D6 — Where the test belongs

Not in `zz-billing-command-races.test.ts`: that suite fires real concurrent REST
requests at a local Supabase to prove *server* guards hold under contention, and
this race is entirely client-side. The server behaved perfectly on 25 August.

It belongs in `src/data-access/supabase-adapters/billing.test.ts`, which already
drives the adapter against a real Dexie over fake-indexeddb. The accept is
landed inside the gap by resolving the server read and then draining before the
outbox read is issued, which is deterministic rather than timing-dependent, and
it fails on the tree today.
