# Design: a-reopened-counter-sends-at-once

## Where the wait comes from

`BillingDrainCoordinator` (`src/outbox/drain.ts`) sends the ready envelopes on
every tick. A send that throws, or answers 408, 429 or 5xx, is rescheduled with
`scheduleRetry(commandId, now + billingRetryDelayMs(attempt))`: exponential from
one second, jittered by ±25 %, capped at `MAX_BILLING_RETRY_MS` (60 s). The
schedule is stored on the envelope as `nextAttemptAtMs`, in IndexedDB.
`listReady` skips anything whose `nextAttemptAtMs` lies in the future.

The only thing that pulls a schedule forward is `store.hintRetry(tabletId, now)`,
called from the coordinator's `online` listener. A page created after that event
fired, which is every reload and every reopen, inherits whatever schedule the
last page wrote, up to sixty seconds out.

## The decision: wake on start, only where the server has just answered

`startRuntime` in `src/data-access/supabase-adapters/billing.ts` builds the drain
only in its non-resume branch. That branch exists only after the session hook
resolved the tablet and its shift **against the server**: an offline cold start
receives an `offlineResume` session, and that adapter returns before building
any drain. So every drain `startRuntime` builds is built immediately after a
real server response.

The coordinator gains one option, `wakeOnStart`. When it is set, `start()` pulls
this tablet's retrying envelopes forward and then triggers, which is exactly
what the `online` listener does, instead of only triggering. `startRuntime`
sets it. Nothing else sets it.

### Offline semantics, stated

- **No reachability claim.** The wake moves a schedule; it reports nothing to
  `onReachability`. Reachability still changes only on the outcome of a real
  request, as `billing-delivery` requires. If the first send after the wake gets
  no answer, it backs off from there as before.
- **Reconnect still re-resolves before it drains.** The wake happens inside a
  drain that is only built after resolution, so `offline-billing-resumption`'s
  ordering is untouched. The offline resume adapter builds no drain and wakes
  nothing.
- **Ordering and exactly-once are untouched.** The wake changes when an envelope
  becomes eligible, not which: dependencies are still checked by `listReady`,
  and a resend of a command that did commit is answered with `replay`, which the
  restart test already proves.
- **Backoff still protects the server.** The adapter, and so the drain, is
  rebuilt when the session resolves again: on reconnect, on a shift change and on
  the five-minute revalidation. Each rebuild costs at most one early attempt per
  waiting chain, after a confirmed server answer. Against a server answering 429
  that is one extra request per five minutes, not a loop.
- **Several tabs.** Web Locks still elects one leader. The wake writes schedules
  in the shared store; whichever tab leads picks them up. The `online` event
  already does the same from every tab.

## Rejected alternatives

- **Always wake in `start()`.** Simpler, but it would make the coordinator
  assert something it cannot know. The coordinator is told "start", not "the
  server just answered"; a future caller building a drain without a confirmed
  session would quietly skip backoff. The caller that holds the evidence decides.
- **Wake in `startRuntime` with `await store.hintRetry(...)` before building the
  drain.** `startRuntime` runs from a subscription and `stopRuntime` can run
  during the await, which would build a drain after the runtime stopped. Doing
  it inside `start()` keeps it ordered with the trigger and covered by `stop()`.
- **Clear `nextAttemptAtMs` when the app loads, before anything resolves.** This
  wakes a queue the tablet has no evidence it can send. On an offline cold start
  it would send nothing anyway, while discarding the schedule the next online
  page would rebuild from.
- **Do not count a send cut off by page unload as a failure** (`pagehide`
  bookkeeping). It treats one cause of the inherited wait and not the other (the
  lost `online` hint), and distinguishing an aborted fetch from a lost network
  in an unloading page is unreliable. The wake covers both.
- **Lower `MAX_BILLING_RETRY_MS`.** Shortens the symptom for every caller and
  weakens the protection backoff exists for.
