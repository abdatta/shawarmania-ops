# Proposal: a-reopened-counter-sends-at-once

> **Model**: Opus · **Kind**: production fix to offline delivery, not a roadmap change · **Gate**: a counter that opens, or reloads, after its session resolves online sends the work it queued at once rather than waiting out the retry delay an earlier page left behind, proved at three layers: `drain.test.ts` fails without the change and passes with it; the adapter's restart test passes with its hand-written `hintRetry` removed and fails that way before the change; and `e2e-auth/billing-served.spec.ts`, run with the reconnect hint deliberately lost, drains in seconds where it took 28–58 s before. A counter reopened **offline** still sends nothing and leaves every delay untouched, proved by an adapter test. The full gate set is green.

## Why

A counter queues every bill, payment and preparation on the tablet and sends
them in order. A send that gets no answer waits before it tries again: one
second, then two, then four, up to a minute. The wait is written into the
tablet's own store, so it outlives the page that wrote it.

Only one thing cuts that wait short: the browser saying the network is back.
That signal reaches the page that is open at that moment. If the counter is
closed and reopened, or reloaded, or simply restarts, the new page never hears
it. It opens, confirms the tablet and the shift with the server, and then sits
on the queue for up to a minute because an earlier page said to.

The design already intended otherwise. The adapter's restart test says in a
comment that a restarted online app makes waiting work immediately eligible,
and then makes it so by hand before restarting, so the test has never checked
that the code does it.

Found on 2026-10-02 while diagnosing `served-spec-reruns-under-load`: with the
reconnect signal lost, a reloaded counter took 28 to 58 seconds to send work it
sent in 2.4 seconds otherwise. It is worst in the most ordinary recovery there
is: the biller notices the Wi-Fi is back and pulls down to refresh. A reload
that cuts off a send in flight makes it worse still, because the cut-off send
counts as a failure and the next page inherits a fresh full minute for it.

## What changes, for the biller

- A counter that opens or reloads with the server answering starts sending its
  queue straight away. The sync indicator settles in seconds rather than
  reading _stalled_ for up to a minute after the network has already returned.
- Nothing else about sending changes. Order, exactly-once delivery, refusals
  and needs-attention work are as they were. A counter reopened while the
  server is still unreachable behaves exactly as today: it sends nothing until
  it can confirm itself, and leaves every waiting delay alone.

## Non-goals

- **No change to the retry schedule** or its one-minute ceiling, and no change
  to how a send is classified. Backoff still protects a server answering 429 or
  5xx: the early retry happens once per confirmed session, not per tick.
- **No special handling of a send cut off by a reload.** It still counts as a
  failure on the page that dies. The next page's early retry makes that
  harmless, and telling a cut-off send from a lost network inside an unloading
  page is fragile for no further gain.
- No change to the offline resume path, the drain leader election or the queue
  schema.
- No ROADMAP.md row: this corrects shipped behaviour.

## Docs this change updates

- `docs/OFFLINE_AND_SYNC.md`, _The outbox_: what cuts a retry delay short (the
  browser's network signal on an open page, and a page that has just confirmed
  itself with the server), and that neither is taken as proof the server is
  reachable.
