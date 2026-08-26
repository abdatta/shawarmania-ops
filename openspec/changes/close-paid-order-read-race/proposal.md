# Close the paid-order read race

> **Model**: Opus 5 · **Kind**: production bug fix, not a roadmap change · **Gate**: **a payment accepted by the server while the pipeline is mid-refresh never puts its order back on screen as unpaid**, proved by a test that lands the accept between the two reads and fails on the tree before the fix — with un-pay-then-repay still working, and a second payment for an order the tablet already holds as paid refused on the tablet rather than by the server.

## Why

On 2026-08-25 at Kalyani the counter took payment for order 26, and nine
seconds later sent a second, separate payment command for it. The database
refused the second one and no duplicate bill exists. But the refusal is the
end of the story, not the beginning: something told the operator that a paid
order was still unpaid, and the operator believed it.

`readOrders` composes one screen from two reads taken at different instants:
the server's `orders` snapshot first, the tablet's outbox second. An accepted
command moves the fact from the outbox into the server row and deletes the
envelope in the same transaction. If that handoff happens between the two
reads, the payment is in neither of them: the snapshot predates it and the
envelope is gone. `readOrders` also clears `orderCache` for the outlet on a
successful server read, so the paid state `payOrder` wrote locally cannot
rescue it either. The order is then `open` and prepared, which is exactly the
predicate `splitPipeline` uses for the payable **Unpaid Prepared Orders**
band, so the card returns wearing a Pay button.

The server's guard is the only thing that stopped a second bill. It cannot
stop an operator asking a customer to pay ₹480 twice, and that is the failure
this change is about.

## What changes

- **Read the outbox before the server snapshot.** The handoff then always
  lands where one of the two reads can see it, in all three timings.
- **Compose the projection once.** The overlay that turns a server snapshot
  plus local envelopes into what the counter believes becomes one named
  function, used by the pipeline read and by the payment guard, so the screen
  and the guard cannot hold different beliefs about the same order.
- **Refuse a duplicate payment on the tablet.** `payOrder` currently validates
  against `readOrder`, which reads the server row alone and applies no overlay.
  It will project the order the way the screen does and refuse when it already
  reads as paid, so a confused screen cannot become a second command.
- Pin all of it, including the un-pay path the guard could break.

## Non-goals

- **No change to the server contract.** `pay_billing_order` already refuses a
  non-open order correctly and that guard stays exactly as it is. This is a
  client-side read defect.
- **No new envelope state and no Dexie version bump.** Keeping an accepted
  envelope until the server read is known to carry it would make the handoff
  atomic rather than merely ordered, and it is the better long-term shape, but
  it is a schema change with a pruning policy attached. Recorded in design as
  the deferred alternative.
- **Nothing about the manager's Status tab**, its undated window, or the
  refusal that is still sitting in it. That surface was handled separately.
- **No retrospective repair.** There is nothing to repair: one refused command,
  no duplicate bill, and every order of that day accounted for.
