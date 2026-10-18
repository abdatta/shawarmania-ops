# Tasks: Billing History Reads What It Shows

No change gate (proposal → *Change gate*: a revert is enough). Measure first,
because design D13's one risk decides whether Stats stays in the day's read; then
the two reads, then the page, which is built on reads that already exist in both
adapters.

## 1. Measure before building

- [x] 1.1 Over the production pooler, read-only, as the owner (`set local
  request.jwt.claims`, `set local role authenticated`; see the memory note on
  reading production data locally), on Kalyani Cafe's busiest day: `EXPLAIN
  ANALYZE` today's PostgREST bills read (the `readBills` select, as PostgREST
  builds it) against a draft of D1's list query for 30 rows, and
  `billing_day_stats` alone against D2's other figures. Record the numbers in
  design D13. If the day's numbers take noticeably longer than the list page,
  move the Stats figures back to their own read on the Stats tab, and correct
  D2, D8 and the spec delta before going on.

## 2. The reads

- [x] 2.1 Migration `billing_history_reads_what_it_shows`: `billing_history_bills`
  (D1) and `billing_day_numbers` (D2), granted to `authenticated` only, revoked
  from `public` and `anon`. Run `npm run lint:migrations`.
- [x] 2.2 pgTAP for `billing_history_bills`: every filter group alone and one
  combination across groups, against seeded bills of every kind (a legacy void
  with no kind, a split tender, a corrected payment, a bill-level discount, a
  failed receipt, a name-only customer, a gold customer, a paper bill with no
  tablet, two tablets); every sort in both directions with ties broken by bill
  number; `matching` with and without a filter; a cursor walk of page size 2
  over the whole day that returns every bill once, and again with a bill inserted
  at the top between pages; no row carries a name or phone; the limit capped at
  100; a franchise admin of another outlet and an anonymous caller get no rows.
- [x] 2.3 pgTAP for `billing_day_numbers`: cash and UPI equal
  `revenue_figures(outlet, day, day)` and Overview's `overview_today_v2` for
  today; `settledBills` and `bills`; `stats` equal to `billing_day_stats`; a
  refusal at 13:00 still listed after 150 later accepted commands; a refusal on
  another day left out; a refusal received after midnight but before the cutover
  counted on the earlier day; `newestCommandAt` from another day; the open count
  and unpaid total, leaving out another day's open order; the tablets; refusal of
  another outlet's franchise admin, a removed device and an anonymous caller with
  `42501`, and a null day. *(59 assertions, green. Cash and UPI are compared with
  `revenue_figures` itself, which `overview_today_v2` also calls, rather than with
  Overview's today, because the seeded day is in 2025. A biller and an employee
  stand in for the removed device: the guard is `billing_day_stats`'s, whose own
  pgTAP covers the device case.)*
- [x] 2.4 Live adapter: `listManagerBillRows(outletId, businessDate, filter,
  after?)`, `readDayNumbers(outletId, businessDate)`,
  `readManagerBillDetail(row)` (one request; D3), and `listManagerOpenOrders`
  taking the day, a manager-only read with no till labels and no outbox overlay
  (D5). Delete `listManagerHistory`, `listDeliveryDiagnostics`,
  `countManagerOpenOrders` and `readDayStats` and their tests. Leave `readOrders`,
  `readBills` and `getBill` as they are. Regenerate database types and check the
  diff carries only the two functions.
- [x] 2.5 Demo adapter: the same four reads from the store (D12), with
  `applyBillFilter` as the rows' reference and the cursor applied after it.
  Unit tests that the demo's rows, cursor walk and figures match what the pgTAP
  cases assert for the same seeded shapes.

## 3. Billing history

- [x] 3.1 Opening the page and changing the day read the first page of rows, the
  day's numbers and the billers together; the strip, AOV and the tab counts come
  from the day's numbers; the Tablet group from its `tablets`.
- [x] 3.2 A filter or sort change re-reads rows from the first page, showing the
  list's shimmer; `Bills (shown/total)` from `matching` and `bills`.
- [x] 3.3 The next page on a sentinel ten rows from the end, with a short shimmer
  at the list's foot, until `matching` rows are shown.
- [x] 3.4 Opening a bill: the row's facts at once, the rest from
  `readManagerBillDetail` behind the detail's own loading state; the in-memory
  cache by bill id for the life of the page (D3).
- [x] 3.5 Cancelling a bill and reviewing an attribution replace the row and the
  cache entry in place and re-read only the day's numbers, quietly (D4).
  Cancelling an order on Open orders removes it and re-reads the day's numbers
  and the shown rows, quietly.
- [x] 3.6 Stats renders from the day's numbers, with no read on choosing it; the
  chip's problems are `refusals`, its age `newestCommandAt`; the tab's red count
  is the day's.
- [x] 3.7 Open orders: the day-scoped read and the kitchen marks together, one
  round trip (D5).
- [x] 3.8 Returning after more than two minutes re-reads the day's numbers and the
  shown rows, quietly, keeping the filter, the expanded bill and the scroll
  position; the Orders tab re-reads itself when it is the one open (D6).
- [x] 3.9 Unit tests: the first page and the next on scroll; a filter change reads
  once and only rows; the detail read once across collapse, another bill and
  reopening; a cancellation patches in place with no list shimmer and one
  numbers read; an order cancellation re-reads rows and numbers; Stats makes no
  read; the two-minute return rule both sides of two minutes; the strip from the
  day's numbers, not from the rows. Update the tests that held the whole day in
  hand or expected a re-read after a cancel.

## 4. Verify

- [x] 4.1 Browser, demo: Billing history at phone and tablet widths, light and
  dark — a long day scrolled to its end, each filter group, a sort change, open
  and reopen a bill, cancel a bill mid-list, Stats, Open orders, a past day — with
  no console errors, and the requests counted per moment against design D8.
- [ ] 4.2 The quick gates (`format`, `lint`, `format:check`, both typechecks,
  `npm test`, `contrast`, `build`) and the DB job (`test:db`, `test:rls`, the
  types diff); then push to `stage` and read the Staging run for the browser
  suites. *(Local, 2026-10-18: every quick gate green — `npm test` 246 files,
  2,979 tests; lint 0 errors; contrast 92 pairs. `test:db` 96 files, 3,929
  tests green on a fresh reset; the types diff is the two functions only.
  `test:rls`: billing-races, drawer-writes, counter-telemetry, change-gates,
  ledger-timing and dish-ticks green; the rls and realtime configs failed 72
  tests, every one a 503 from the local Edge runtime ("failed to determine
  entrypoint" — it is mounted on another checkout), none touching this change.
  Not pushed: waiting on the owner.)*
- [ ] 4.3 On staging after it publishes, and in production after a Promote: open
  Billing history in the owner's browser and count requests and round trips per
  moment against D8, and read the edge logs for the two new functions' times
  against today's full bills read (290–610 ms India, 770–1,500 ms US at 85–125
  bills).

## 5. Close

- [x] 5.1 Update `docs/SCREENS.md` and `docs/DATA_MODEL.md` as the proposal lists.
- [ ] 5.2 PHASE GATE: no roadmap row, so no roadmap checkpoint. A green Staging
  run on the pushed commit, a Promote, and the owner using Billing history through
  a busy day's service. Archive after #78 has archived (this delta modifies its
  requirements) and after the owner calls it.
