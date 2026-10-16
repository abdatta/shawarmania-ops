# Tasks: the-app-asks-the-server-less

## 1. The gate, off

- [x] 1.1 Declare `fewer-requests` (code `FR`, kind `change`, `retireBy` 2027-01-31, `roundTrip: 'none: …'`) in `src/change-gates/gates.ts`.
- [x] 1.2 Migration `20261024000000_the_app_asks_the_server_less.sql`: the gate's `change_gates` row, off, `-- change-gate: fewer-requests` in its header, no `change_number`; and `report_device_health_v2` (D8). Run `npm run lint:migrations` and `npm run lint:change-gates`.
- [x] 1.3 The demo's words for the gate in `src/data-access/mock/change-gates.ts`.

## 2. The shared freshness rules

- [x] 2.1 `src/lib/freshness.ts`: the four constants, `olderThan`, `mergeBursts` (D2), with unit tests.

## 3. The on path

- [x] 3.1 Kitchen: both boards key their category effect on the filter's mode and ids, gate on (D3).
- [x] 3.2 Counter: the channel helper passes the table to listeners; the counter splits menu from sale notices, merges bursts, and reloads the menu on a sale only when older than two minutes, gate on (D4).
- [x] 3.3 Expense categories adapter `names()` (Supabase and mock); `ExpenseList` uses it, gate on (D5).
- [x] 3.4 `useSharedRead` records `readAt` and re-reads on the foreground only when stale, gate on (D6).
- [x] 3.5 The aggregator page checks a running sync every `RUNNING_SYNC_CHECK_MS`, gate on (D7).
- [x] 3.6 Gates on the health report: adapter `reportHealthReadingGates()` (Supabase and mock); `startChangeGateRefresh` takes `minuteRead` and accepts offered answers; `useDeviceHealthReport` offers the v2 answers and falls back to `read()`; the counter and kitchen roots wire both, gate on and `tablet-health` on (D8).

## 4. Tests, both states

- [x] 4.1 Unit, `describeChangeGate('fewer-requests', …)` for each toggle point: kitchen category reads, counter menu and sale notices, expense names, foreground re-read, running-sync interval, gate answers from the report and the fallback.
- [x] 4.2 pgTAP: `report_device_health_v2` writes the same row v1 writes, returns every live gate's answer, refuses a caller with no device session, and is not executable by `anon`.
- [x] 4.3 Browser (auth suite): `e2e-auth/fewer-requests.spec.ts`, `@cg-on:fewer-requests`, the lower request budget (D9), with its readings recorded. *(Three local runs with every gate on: counter idle 2, 2, 2; kitchen idle 5, 5, 6; payment 23, 23, 23; budgets 3, 9, 35. It also asserts by path that neither tablet reads `change_gates` and the kitchen reads no `menu_categories` in the idle minute, and a sale reloads the menu at most once. The request budget, run beside it with every gate on, held and read lower than before: ACK 3, dish tick 23. Added to the request budget's CI shard.)*
- [x] 4.4 `npm run db:types` and commit the generated types.

## 5. Docs

- [x] 5.1 `docs/ARCHITECTURE.md`: how a screen keeps its data fresh.
- [x] 5.2 `docs/TESTING.md`: the second request budget.
- [x] 5.3 `docs/OPERATIONS.md`: Supabase log volume, measuring it, reading logs within the query allowance, and the `cron.log_statement` step.
- [x] 5.4 `docs/RELEASES.md`: a tablet's health report carries the gate answers with this gate on.

## 6. Verify

- [x] 6.1 `npm run format`, then `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build`. *(All green: `npm test` 243 files, 2966 tests; contrast 92 pairs in both themes.)*
- [x] 6.2 The database job on the local stack: `db:reset`, `test:db`, `test:rls`, `db:types` with no diff. *(On a fresh reset in CI's order: `test:db` 92 files, 3763 tests; `test:rls` every file green; regenerated types identical to the committed 11-line addition. A first `test:rls` run after the browser runs failed one device-health count on the spare tablet's leftover row, which is the run order AGENTS.md warns about, not this change.)*
- [x] 6.3 `npx playwright test` for the new budget spec, gates on, locally; the four browser suites on Staging. *(Local: the budget specs as in 4.3, and the demo specs for the touched screens — counter, kitchen filter, change gates, expenses, delivery history — 130 passed gates off and 98 gates on. Staging run 38795129252 on `aef1206d` passed every job in 13 minutes, all four browser suites in both states, then migrated staging, deployed its functions, published and passed its smoke check.)*
- [x] 6.4 Each toggle point proved by reverting it: its on-path unit test fails. *(Kitchen categories, the counter's two-minute menu rule, `mergeBursts`, expense names, the foreground rule, the running-sync interval, the offered answers and the report's read fallback each failed their test when reverted. The roots' `minuteRead` wiring has no unit test; the browser spec's by-path assertion is what catches it.)*

## 7. PHASE GATE

- [ ] 7.1 No roadmap row, so no roadmap checkpoint: a green Staging run on the pushed commit, then the owner turns `fewer-requests` on in staging and in production after a Promote, and watches a full billing cycle's log ingestion on the Usage page against this cycle's ~2 GB pace. Archive waits for that cycle.
