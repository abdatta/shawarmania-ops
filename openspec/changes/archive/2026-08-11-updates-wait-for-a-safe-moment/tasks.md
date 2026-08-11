# Tasks: updates-wait-for-a-safe-moment

## 1. Close the forced reload at its source

- [x] 1.1 Add a module-level update store under `src/pwa/` exposing subscribe,
  getSnapshot and a one-shot "an update is ready" record, readable from React
  through `useSyncExternalStore` without moving registration into a provider
  (design D2).
- [x] 1.2 Pass `onNeedReload` from `registerServiceWorker`, whose body records the
  update and does nothing else, so the plugin's own `window.location.reload()`
  path is closed rather than raced (design D1).
- [x] 1.3 Keep `onNeedRefresh` calling `updateServiceWorker()` so the new worker
  still activates and the next load runs the new build, and correct the
  misleading `false` argument and its comment.
- [x] 1.4 Replace the `clientsClaim` reasoning comment in `e2e/offline.spec.ts`,
  which conflates a first worker claiming uncontrolled pages with an updated
  worker taking control, and state what actually keeps an open page safe.

## 2. Discover a new build without a relaunch

- [x] 2.1 Extract the update check into one callable function so every trigger,
  and any future trigger, is one more caller (design D10).
- [x] 2.2 Call it on launch, on `visibilitychange` to visible, on `online`, and on
  a five-minute interval, with no cooldown suppressing any call.
- [x] 2.3 Tear down the interval and listeners cleanly, and prove a check is
  never issued after teardown.

## 3. Measure whether a reload would cost anything

- [x] 3.1 Add a document-level capturing `input` listener that records which
  elements have been typed into and how much, dropping entries whose element has
  left the DOM or been emptied when a snapshot is read (design D3).
- [x] 3.2 Apply the threshold: three or more fields typed into, or one field
  carrying roughly a sentence or more, counts as occupied; keep both numbers as
  named constants in one module (design D4).
- [x] 3.3 Add a declaration channel for work not held in form controls, and
  declare it from `src/features/billing/billing-counter.tsx` while the composed
  order has lines (design D6).
- [x] 3.4 Count in-flight writes once at the adapter seam rather than per surface,
  covering every present and future write (design D7).
- [x] 3.5 Compose the four conditions (online, no declared work, under the typing
  threshold, no write in flight) into one occupancy snapshot.

## 4. Apply the update when it costs nothing

- [x] 4.1 Reload automatically when an update is recorded and the page is
  unoccupied, after a settle delay followed by re-confirmation, and not at all if
  the page becomes occupied again during that delay (design D8).
- [x] 4.2 Guarantee at most one reload per detected update, so no edge can produce
  a reload loop on an unattended tablet.
- [x] 4.3 Never reload while the app reports no connectivity, whatever else is
  true of the page (design D5).

## 5. Offer the update in the header

- [x] 5.1 Rename the shells' `installAction` prop to `appAction` across
  `src/shell/counter-shell.tsx`, `src/shell/phone-shell.tsx`, `src/auth/real-root.tsx`
  and `src/routes/root-layout.tsx`.
- [x] 5.2 Add one component that chooses between the install and update actions in
  that single slot, with installation taking precedence (design D9).
- [x] 5.3 Build the update action on the same semantic tokens, 44px minimum
  target and accessible naming as the install action, extracting
  `usePrefersReducedMotion` into `src/lib/` now that both need it.
- [x] 5.4 Keep the action visible once shown until the update is applied, and
  apply the update when it is activated.
- [x] 5.5 Cycle the update action's label open and closed for as long as the
  update is unapplied, unlike the install action's once-per-tab reveal, holding
  the accessible name constant and suspending the cycle under reduced motion
  with the label left visible (design D11).
- [x] 5.6 Confirm demo shells still render no app-owned action while continuing to
  auto-apply when unoccupied.

## 6. Prove it

- [x] 6.1 Unit-test the occupancy rules: one short entry does not defer, three
  fields do, one long entry does, a composed order does, a write in flight does,
  and being offline does.
- [x] 6.2 Unit-test the decision: settle-then-reconfirm, no reload if occupancy
  returns during the delay, at most one reload per update, and install
  outranking update in the slot.
- [x] 6.3 Extend the Playwright PWA coverage so a deferred update surfaces the
  action and an unoccupied page takes the update by itself, against a real
  production build.
- [x] 6.4 Re-run `e2e/offline.spec.ts` against the new reload timing and adjust
  its priming only if the behaviour genuinely changed, never to force green.
- [x] 6.5 Check the update action in both themes on a phone viewport and a
  tablet viewport, and run `npm run contrast`.

## 7. Records

- [x] 7.1 Update `docs/OPERATIONS.md`, `docs/SCREENS.md`, `docs/TESTING.md` and
  `docs/LIMITATIONS.md` as named in the proposal.
- [x] 7.2 Confirm `openspec/todos/` carries the deferred deploy-announcement idea
  and that its index row is present, so the backlog drift check passes.

## 8. Phase gate

- [x] 8.1 **GATE**: a deployed build never reloads a running page on its own; an
  app left open discovers a new build within five minutes or on its next return
  to the foreground or reconnection, without being relaunched; a page holding
  typed work, a composed order, a write in flight, or no network offers an
  Update action instead of reloading and takes the update itself once every one
  of those clears; Install still wins the one header slot when both apply; and a
  detected update reloads at most once. Proved by `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm run test:e2e` and `npm run contrast`,
  with the browser walk recorded in the verification report.
