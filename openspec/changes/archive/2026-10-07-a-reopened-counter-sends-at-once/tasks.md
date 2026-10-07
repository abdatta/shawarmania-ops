# Tasks: a-reopened-counter-sends-at-once

## 1. The coordinator can wake on start

- [x] 1.1 `drain.test.ts`: a coordinator started with `wakeOnStart` sends a retrying envelope whose `nextAttemptAtMs` lies in the future, without any `online` event, and reports reachability only from the send's outcome. Run it before 1.2 and watch it fail.
  - Two tests: the woken send is delivered with reachability untouched until it answers, and a woken send that gets no answer backs off from attempt 2 to 3 (`nextAttemptAtMs` 14 000) and reports unreachable. Both failed before 1.2 with `execute` never called.
- [x] 1.2 `BillingDrainCoordinator` takes `wakeOnStart?: boolean`; `start()` with it set pulls this tablet's retrying envelopes forward and then triggers, as the `online` listener does. Without it, `start()` is unchanged: the existing "treats the browser online event only as a retry hint" test still proves a plain start leaves the delay alone.
  - `start()` calls the same `onConnectivityHint` the `online` listener uses, so the wake is ordered before its trigger and covered by `stop()`. 11 of 11 pass, the plain-start test among them.

## 2. Only a server-confirmed counter wakes

- [x] 2.1 `startRuntime` builds its drain with `wakeOnStart: true`. It already builds a drain only on the non-resume branch.
- [x] 2.2 `billing.test.ts`, _repairs a lost final heartbeat…_: remove the hand-written `store.hintRetry` before the restart, so the test proves the restarted adapter makes the work eligible itself. Confirm it fails that way before 2.1 and passes after.
  - The hand-written hint became a full `MAX_BILLING_RETRY_MS` delay set on the envelope, as a reload that cuts off a send leaves. Before 2.1 it failed with the restarted adapter still reporting 1 unsent; after, it passes.
- [x] 2.3 `billing.test.ts`: an adapter built from an offline resume session, holding a retrying envelope, leaves its `nextAttemptAtMs` and `attemptCount` unchanged and sends nothing.
  - Asserted via a resume adapter whose client would answer nothing: the indicator reads stalled, the delay and attempt count are unchanged, and no RPC is made.

## 3. The real counter

- [x] 3.1 Run `e2e-auth/billing-served.spec.ts` with the reconnect hint deliberately lost (app taken away before the network returns), before and after: before, it drained in 28–58 s; after, it should drain in seconds. The harness stays out of the commit.
  - Worst case (a failed attempt just before the app went away, hint lost): 58.3 s on the old code in three of three runs; 0.9 s and 0.3 s after, with the spec's exactly-once assertions passing.
- [x] 3.2 Run the offline billing auth specs unchanged.
  - Green on a fresh stack inside the full auth run (34 of 34). Rerun without a reset, `billing-offline` and `billing-two-tablets` fail on earlier runs' customers; that predates this change and is filed as `openspec/todos/auth-billing-specs-not-independent-of-reruns.md`.

## 4. Docs

- [x] 4.1 `docs/OFFLINE_AND_SYNC.md`, _The outbox_: what cuts a retry delay short, and that neither cause is taken as proof of reachability.

## 5. Gate

- [x] 5.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`; then a fresh `db:reset`, `test:db`, `test:rls`, `test:e2e:auth`.
  - 2026-10-02 21:45–21:54Z: lint, format, typecheck, functions typecheck, contrast, 2158 unit tests, build, 284 demo e2e; then `db:reset`, `test:db` (2939), `test:rls` (all six phases), `test:e2e:auth` (34).
- [x] 5.2 PHASE GATE: no roadmap checkpoint, as a fix. The Gate line in `proposal.md` holds clause by clause, and the commit stays local: the owner picks the deploy window.
  - Deployed with `99576fd5` and in real use at Kalyani Cafe from 2026-10-03. Read from production 2026-10-07: every one of the 381 orders billed since 2026-10-02 has exactly one bill, and no customer bill earned points or queued its receipt SMS twice. The owner archived it on 2026-10-07.
