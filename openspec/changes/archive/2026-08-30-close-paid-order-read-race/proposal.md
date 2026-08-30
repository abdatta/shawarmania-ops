# Close the paid-order read race

> **Model**: Opus 5 · **Kind**: production bug fix, not a roadmap change · **Gate**: **a payment or preparation accepted by the server while the pipeline is mid-refresh never puts its order back on screen as undone**, proved by a test that lands the accept between the two reads and fails on the tree before the fix — with un-pay-then-repay still working, an already-taken action refused on the tablet rather than by the server, **a refusal that cannot succeed unchanged offering discard rather than correction**, and **every refusal naming the order it was about**.

## Why

On 2026-08-25 at Kalyani the counter took payment for order 26, and nine
seconds later sent a second, separate payment command for it. The database
refused it and no duplicate bill exists. But the refusal is the end of the
story, not the beginning: something told the operator that a paid order was
still unpaid, and the operator believed it.

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

The next day proved the defect is not payment-specific and does not stop
there. Three more refusals arrived, and they are two further faults:

- **The same torn read, losing preparation instead of payment.** At 20:05 on
  2026-08-26, order 24 was marked prepared and accepted; 6.7 seconds later a
  second preparation for it was refused because it was already paid and
  already prepared. A paid-but-unprepared order stays in Preparing, so losing
  that accept leaves the card asking to be prepared again.
- **Correction resubmits a refusal that can never succeed.** The two refusals
  at 17:06 and 17:11 on 2026-08-26 carry the *identical* payload hash and the
  *identical* `client_created_at` as the original from the previous day. That
  is `correctAttention`, which copies the command verbatim and swaps only its
  id. An operator followed the panel's own advice and pressed correct twice.
  Both were refused for the reason the first was, and each attempt wrote a new
  permanent row. Following the advice multiplies the alarm.

Neither the panel nor the operator could tell which order any of this was
about, because the refusal result drops it. The SQL has `v_order` in hand and
returns `orderStatus` without `orderId` or `orderNumber`, while the accepted
path returns both. The order numbers above were recovered by correlating
timestamps against `orders`, which is not a thing a biller can do at a counter.

The server's guard is the only thing that stopped a second bill. It cannot
stop an operator asking a customer to pay ₹480 twice, and that is the failure
this change is about.

## What changes

- **Read the outbox before the server snapshot.** The handoff then always
  lands where one of the two reads can see it, in all three timings.
- **Compose the projection once.** The overlay that turns a server snapshot
  plus local envelopes into what the counter believes becomes one named
  function, used by the pipeline read and by the action guards, so the screen
  and the guards cannot hold different beliefs about the same order.
- **Refuse an already-taken action on the tablet**, for payment and for
  preparation alike, so a confused screen cannot become a command.
- **Split correctable refusals from terminal ones.** A refusal whose payload
  cannot succeed however many times it is resent offers discard only. The spec
  already says a *correctable* permanent refusal moves to needs attention; the
  implementation has been treating every permanent refusal as correctable.
- **Name the order in the refusal.** The command functions already hold the
  order row; the refusal result gains its number and id, so the tablet and the
  manager's panel can say which order rather than only what went wrong.
- Pin all of it, including the un-pay path the guard could break.

## Non-goals

- **No change to any guard's verdict.** `pay_billing_order` and
  `prepare_billing_order` refuse exactly what they refuse today. The migration
  in this change adds fields to a refusal result and changes no decision.
- **No new envelope state and no Dexie version bump.** Keeping an accepted
  envelope until the server read is known to carry it would make the handoff
  atomic rather than merely ordered, and it is the better long-term shape, but
  it is a schema change with a pruning policy attached. Recorded in design as
  the deferred alternative.
- **No acknowledgement mechanism.** A refusal still cannot be cleared from the
  manager's Status panel, and still ages out of its rolling window instead.
  Naming the order makes the row legible; it does not make it dismissible.
  That remains its own piece of work.
- **No retrospective repair.** There is nothing to repair: no order has two
  bills, no paid order lacks one, and every refusal is the server declining
  work that was already done.
