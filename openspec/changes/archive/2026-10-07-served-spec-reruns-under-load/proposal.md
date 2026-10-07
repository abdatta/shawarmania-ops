# Proposal: served-spec-reruns-under-load

> **Model**: Opus · **Kind**: test-only fix, not a roadmap change · **Gate**: `e2e-auth/billing-served.spec.ts` passes with the reconnect retry hint lost, retry jitter at its top and every RPC 1.5 s slower, where the old 60 s drain budget failed; it passes again on a rerun without `db:reset`, with an earlier run's paid, unprepared member takeaway still on the rail, where the old locator failed in strict mode; and the full file passes unmodified.

## Why

On 2026-10-02, around 17:00 IST, *orders rung offline with a table, bags and a
waiver each settle exactly once* failed locally on `57b23779` while CI's
`Deploy` for the same commit had passed. The run timed out waiting for the
sync indicator to read `synced`, seeing `stalled` and then `pending`. A rerun
without a reset then failed differently: the member's `Prepared` button
resolved to two elements. These are two faults in the test, and neither is in
the counter.

**The drain budget equalled the outbox's longest retry delay.** While the till
is offline, each head-of-chain command fails and backs off, reaching
`MAX_BILLING_RETRY_MS` (60 s) by the time the network returns. The `online`
event pulls those retries forward, but it is written by the old page, and the
spec reloads straight after reconnecting. When the reload wins, or aborts a
delivery in flight and leaves it a fresh full delay, the new page inherits up to
60 s of backoff. The commands not stuck behind it drain at once, which drops
the indicator from `stalled` (five or more queued) to `pending`; the last chain
waits out its delay and then delivers four commands in sequence. Measured with
the hint deliberately lost: 58.3 s on an idle machine against a 60 s budget,
and 62.9 s with each RPC 1.5 s slower, which failed. Unrelated to the clock:
the same shape reproduced at 02:00 IST.

**One card lookup was not scoped to its own run.** Every other order in the
file is found by a customer name unique to the run. The gold member is the
seed's fixed customer, so the member's takeaway was found by `"Takeaway"`
alone, which also matches a member takeaway a failed run left paid and
unprepared on the server.

## What Changes

- `DRAIN_MS` is `MAX_BILLING_RETRY_MS + 30_000`, imported from the outbox, so
  the budget follows the delay it has to outlast.
- `unsentCardsAt` finds cards by the `open-order-local-` prefix: the orders
  this till rang offline and has not sent. Anything the server already holds
  carries a number, so an earlier run's leftovers are out of reach. The member's
  takeaway is paid and prepared through it; the till is offline throughout, so
  the card cannot change identity under the locator.
- `payCard` and `serveCard` take the card locator rather than a text, so the
  caller states the scope.

## Non-goals

- **No change to outbox behaviour.** A page that starts online still waits out
  backoff it inherited from offline, up to 60 s, before it sends. Whether a cold
  start should count as a reachability hint is a question about outbox
  semantics, which this lane does not take; it is noted for a separate change.
- No cleanup of leftovers from failed runs. Scoping makes them harmless here,
  and `db:reset` remains the way to clear them.
- The two-till test's `cardsAt(page, 'Table 4')` count is unscoped too, but it
  can only be affected by a failure of that same test, and nothing observed one.
