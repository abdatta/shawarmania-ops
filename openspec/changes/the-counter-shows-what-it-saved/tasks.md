# Tasks: the-counter-shows-what-it-saved

Read `proposal.md` and `design.md` first. The decisions (D1–D8) and the rejected
alternatives are there; do not re-open them without a reason the design did not
consider. The off path is today's code, untouched: every edit below is a new
branch taken only when `useChangeGate('instant-saves')` is true, or a new adapter
method nothing off-path calls.

## 1. The gate, off

- [x] 1.1 Declare `instant-saves` in `src/change-gates/gates.ts`: `kind: 'change'`,
  `code: 'IS'`, `change: 'the-counter-shows-what-it-saved'`,
  `dependsOn: ['dish-ticks', 'kitchen-ready']`, `retireBy: '2027-01-15'`, `roundTrip` the `none:`
  sentence from design → *Version skew*. A doc comment in the file's voice.
- [x] 1.2 Migration `supabase/migrations/20261023000000_the_counter_shows_what_it_saved.sql`
  (the next free timestamp after the latest on `main`; re-check before writing —
  `20261022000000` went to the pop-up change on `stage` first, so this moved to
  the next):
  insert the `change_gates` row (title *Instant saves*, `on_means` and `off_means`
  word for word from the proposal's Change gate section, `change_name`,
  `change_number` null: no roadmap row), and two `change_gate_dependencies` rows,
  on `dish-ticks` and on `kitchen-ready`. Nothing else. Run `npm run lint:migrations` and
  `npm run lint:change-gates`.
- [x] 1.3 Add the gate's owner-facing words to `WORDS` in
  `src/data-access/mock/change-gates.ts` so the demo's Change gates page lists it.
- [x] 1.4 Run the existing change-gate unit and RLS suites
  (`vitest.change-gates.config.ts`) and confirm the new row reads back off, and
  that it cannot be turned on while `dish-ticks` or `kitchen-ready` is off, and
  turns off when either does.
- [x] 1.5 Every screen test below wraps the counter in `dish-ticks` and
  `kitchen-ready` on, and varies only `instant-saves` (design D7). Nothing is
  built or tested for a counter with either #74 gate off.

## 2. Reads that never touch the network (D1)

- [x] 2.1 Failing tests first, in `src/data-access/supabase-adapters/billing.test.ts`,
  with the client's requests held unanswered: `peekOpenOrders` returns an order
  just saved and an order just revised (new lines and total); returns `null` before
  any `readOrders` of the outlet; after a completed read, equals what the
  server-failure branch of `readOrders` returns for the same cache and envelopes.
  `peekShiftHistory` includes a `pay_now` bill, a corrected tender, a taken-back
  payment and a cancel-after-paid, with totals equal to `listShiftHistory`'s over
  the same overlay; returns `null` with no server read of the shift and no resume
  record.
- [x] 2.2 Factor the local half of `readOrders` (envelopes, cache in place of the
  response, projection, the `newer()` precedence) into one function called by both
  the failure branch and `peekOpenOrders`. Track which outlets have completed a
  read (or were seeded from a resume record) for the `null` rule.
- [x] 2.3 `listShiftHistory` keeps its last server bills per shift in memory.
  Factor the totals into one helper. `peekShiftHistory` overlays the kept bills (or
  the resume record's) with `overlayDurableBills` and that helper.
- [x] 2.4 Add both methods to `BillingAdapter` in `src/data-access/adapters.ts`, with
  the doc comments from design D1. The demo adapter returns its lists; a test in
  `src/data-access/mock/billing.test.ts` pins that they agree.
- [x] 2.5 Prove 2.1 bites: break the factored local half (drop the projection) and
  watch the peek tests fail; restore. *Done differently, 2026-10-14:* dropping the
  order projection fails nothing, because every write already puts its order in
  the cache the peek starts from. What was broken instead: the `null` rule (the
  first test fails) and the shift overlay given no envelopes (the payment test
  fails). Restored, all 53 adapter tests pass.

## 3. The rail draws an own save (D3, D4)

- [x] 3.1 Failing tests first, a new `src/features/billing/instant-saves.test.tsx`
  modelled on `dish-refresh-latency.test.tsx`, under
  `describeChangeGate('instant-saves', (on) => …)` with `listOpenOrders` held
  unanswered. On: Order puts the card on the rail with its dishes, label and total
  and the number's awaiting shape; Save changes redraws the card with the new dish
  and total; a read started before Order and released after it never removes the
  card. Off: the card is absent until the held read is released, as today.
  *Note, 2026-10-14:* the older-read test pins the behaviour but does not fail
  when the rail's own `queue.invalidate()` is removed: a save re-renders the
  composer, which hands the rail a new callback, and the rebuilt refresh queue
  drops the older read too. The explicit invalidation stays, because that
  rebuild is an accident of callback identity, not a promise.
- [x] 3.2 `DishOpenOrdersSurface` gains an `ownSaveKey` prop. On its change, with
  the gate on: `queue.invalidate()`, draw `peekOpenOrders` (when not `null`, through
  the same `setOrders` and `onOrdersRead`, not `refreshMarks`), take tender labels
  from `peekShiftHistory` likewise, then `load()`. Thread it through
  `CounterActivityRail` / `CounterActivity`.
- [x] 3.3 In `BillingCounter`, with the gate on, `saveOrder` and `reviseEditedOrder`
  bump the rail's own-save key in place of `pipelineRefresh`. `savedOrderKey` is
  unchanged. Off: today's bumps, untouched.

## 4. Bills draws an own save (D3, D4, D5)

- [x] 4.1 Failing tests first, in `instant-saves.test.tsx`, with `listShiftHistory`
  held unanswered. On: Pay now puts the bill in Bills this shift with the totals
  moved; Paid on a rail card does the same; Edit payment shows the new tender; Take
  back shows the bill taken back **and** puts the order back on the rail; a failed
  re-read after Take back keeps *The payment was taken back and the order
  reopened.* and shows neither failure message; a failed refresh with bills on
  screen keeps them with no error; *Could not load this shift.* only with nothing
  to show. Off: each waits for the held read, and the failure messages are today's.
- [x] 4.2 `MyShiftSurface` in records mode gains `ownSaveKey` and an `onOwnSave`
  callback. With the gate on: on `ownSaveKey`, `queued.invalidate()`, draw
  `peekShiftHistory`, then `queued.refresh()`. Its own actions set their
  confirmation when the write resolves, call `onOwnSave`, and run the re-read
  outside the action's `try` so its failure cannot reach the action's `catch`. A
  failed read with `history` already shown keeps it and sets no message.
- [x] 4.3 Wiring, gate on: `BillingCounter`'s `settle` and the rail's
  `onActivityChanged` bump an own-save key for Bills, lifted through `CounterShell`
  beside today's `billRefresh` to `CounterRecords` → `MyShiftSurface`. The Bills
  panel's `onOwnSave` goes back through `CounterRecords` → `CounterShell` →
  `BillingPanel` → `BillingCounter` → the rail's own-save key. Off: today's
  `billRefresh` only.

## 5. The table picker (D6)

- [x] 5.1 Failing test first: gate on, `listOpenOrders` held, an order for table 4
  just saved; opening the picker marks table 4 busy. Off: it does not until the
  read is released.
- [x] 5.2 In `openTables`, with the gate on, set `tableOrders` from
  `peekOpenOrders` (when not `null`) before the `listOpenOrders` call.

## 6. In the browser

- [x] 6.1 An `e2e-auth` spec tagged `@cg-on:instant-saves`, on the real local
  stack: `page.route` delays the `orders` and `bills` REST reads by five seconds;
  press Order, and the card is visible within one second; pay it from the card, and
  the bill is in Bills this shift within one second; take it back from Bills, and
  the order is on the rail within one second. Then release the delay and the order
  number arrives.
- [x] 6.2 Run `e2e-auth/request-budget.spec.ts` with every gate on
  (`npm run test:e2e:auth:on`). The budget does not change; if it fails, the design
  is wrong, not the budget.
- [x] 6.3 The demo suites, both gate states (`npm run test:e2e`,
  `npm run test:e2e:on`). Check the four-role walkthrough walks and the demo's
  Change gates page lists *Instant saves* under *Dish ticks*. *2026-10-14:* on,
  328 passed; off, 347 passed and one failed — `e2e/analytics.spec.ts` *Items
  charts any dish or category … in dark* on the phone project, a 90 s click
  timeout on an analytics screen this change does not touch, which passed alone
  on rerun. The Change gates page test now lists *Instant saves* beside *Kitchen
  Ready* among what turning *Dish ticks* off takes with it.
- [ ] 6.4 By hand in the browser pane, both themes, gate on: save, edit and pay
  with the network throttled in devtools; no card blinks off and on, and nothing
  reflows when the server's answer lands. *Not done, 2026-10-14:* the pane has no
  devtools throttling, and the demo asks no network, so it looks the same either
  way. The held-route browser spec (6.1) did this on the real local stack with
  every gate on. The owner's throttled try on *Cafe Staging* (9.1) is the look.

## 7. Docs

- [x] 7.1 `docs/OFFLINE_AND_SYNC.md`, *Rules that make this safe*: the counter
  draws its own saves from its own record first; a read begun before a save never
  draws over it; why only own saves invalidate (design D3).
- [x] 7.2 `docs/SCREENS.md`: the rail and Bills panel showing a save at once; the
  table picker.
- [x] 7.3 `docs/TESTING.md`: the held-back-read unit tests and the delayed-route
  browser spec.
- [x] 7.4 `docs/LIMITATIONS.md`: the follow-ups in the proposal that remain (a slow
  reload waits with no limit; the two-second send; the kitchen's ACK; the customer
  lookup while slow).

## 8. Verify

- [x] 8.1 The local gates CI runs (see `.github/workflows/verify.yml` for the
  current list): format, `npm run lint`, types, `npm test`, build, and the database
  job from a fresh reset including `npm run test:rls`. Report the numbers.
  *2026-10-14:* lint (0 errors), format, types, Edge Function types, contrast and
  build clean; 2,889 unit tests in 235 files; from a fresh reset, 3,749 pgTAP
  assertions in 91 files and every `test:rls` phase. Auth browser, gates on:
  `instant-saves.spec.ts` (and the same steps fail with gates off), the request
  budget unchanged, `dish-ticks.spec.ts` and `billing-offline.spec.ts`, 7 passed.
  A database run after those browser runs, without a reset, failed four
  count-sensitive pgTAP checks and one tablet-health REST check on their rows; a
  reset cleared every one.
- [ ] 8.2 Squash to three to five commits and push `HEAD:stage`, never `main`. The
  stage push runs the browser suites in both gate states.

## 9. PHASE GATE

- [ ] 9.1 **PHASE GATE — release checkpoint** (AGENTS.md → *The life of a change*;
  no ROADMAP.md row, as a correction): CI green on `stage` in both gate states;
  the owner tries it on *Cafe Staging* with the network throttled; an
  owner-approved Promote deploys it to the counters **off**; the owner turns
  `instant-saves` on at a quiet hour and watches the tablets on the gate's page,
  then pulls it once, off and on again; it runs through real service. Archive only
  after that, on the owner's word.
