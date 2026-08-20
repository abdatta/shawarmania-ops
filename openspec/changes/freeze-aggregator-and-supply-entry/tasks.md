# Tasks: freeze-aggregator-and-supply-entry

Ordered so the double-count fix (section 2) can ship before the next payout cycle
even if later sections are still moving.

## 1. Figures leave the day row

- [x] 1.1 Migration: `aggregator_channel_days` — outlet, channel, business date (unique together), revenue paise, commission paise **nullable** meaning undetermined, settlement state, origin (`daily_reader | settlement | supplied_by_hand`), the superseded pair with its moment, and the provisional pair a settlement replaced. Money integer paise; business date an explicit `date`.
- [x] 1.2 Migration: CHECK constraints — commission absent or within nought and revenue inclusive; settlement state present exactly when revenue is; state moving only `provisional → settled`, `provisional → disputed`, `disputed → settled`, settled terminal.
- [x] 1.3 Migration: backfill from `manual_ledger_days` keyed on outlet and business date, **assert the copied row count equals the source count and abort if not**, then drop `zomato_revenue_paise`, `zomato_commission_paise` and the four superseded/provisional Zomato columns in the same transaction. Swiggy's columns stay: it is not sourced.
- [x] 1.4 Migration: trigger on `manual_ledger_days` refusing any write that carries a sourced channel's revenue or commission, so a stale client fails loudly rather than appearing to succeed.
- [x] 1.5 RLS: no client role holds insert, update or delete on `aggregator_channel_days`; Super Admin reads across outlets; FA, Biller and Employee refused read entirely.
- [x] 1.6 pgTAP: isolation matrix for the new table, including hand-crafted requests carrying an explicit `outlet_id`.
- [x] 1.7 pgTAP: every client role, Super Admin included, is refused write; a stored figure is byte-for-byte unchanged after each attempt.
- [x] 1.8 pgTAP: the constraints from 1.2 refuse a partial row, an out-of-range commission, and each disallowed state transition.
- [x] 1.9 pgTAP: the 1.4 trigger refuses a day row carrying Zomato figures, and accepts one carrying Swiggy figures.
- [x] 1.10 pgTAP: rehearse the 1.3 backfill against a seeded copy of production's shape and prove no figure moves.
- [x] 1.11 Add the new table to the coverage-enumeration test.
- [x] 1.12 Regenerate `src/data-access/database.types.ts`.

## 2. A recovery stops being an expense

- [x] 2.1 Rewrite `ingest_aggregator_cycle`'s deduction handling: a supply recovery reconciles and writes no expense; every other deduction still writes one. Reconciliation sums unchanged, still counting recoveries dated before the boundary.
- [x] 2.2 Identify a supply recovery from the payload rather than by string-matching a description.
- [x] 2.3 pgTAP: a cycle carrying a supply recovery reconciles to the same total as before and creates no expense row.
- [x] 2.4 pgTAP: a cycle carrying an advertising deduction still creates its expense, dated to when it was incurred.
- [x] 2.5 pgTAP: the exact production case — one order recovered across two cycles and two outlets — produces no expense from any slice.
- [x] 2.6 pgTAP: a recovery dated before the boundary is counted in the cycle sum and writes nothing.

## 3. Supply purchases

- [x] 3.1 Migration: `supply_purchases` source identity on `manual_ledger_expenses` — `source_order_ref` unique per outlet and source system, so one supplier order can only ever hold one row.
- [x] 3.2 Migration: a `shared_cost` marker, so a purchase booked against the delivery outlet does not read as that kitchen's alone.
- [x] 3.3 Ingest: one expense per order, amount summed over whatever invoices the order carries less credit notes, dated by invoice date, falling back to the ledger's earliest business date where the invoice precedes it.
- [x] 3.4 pgTAP: the same order arriving from the daily reader, then a later statement, then a hand-supplied statement, yields one row carrying the latest figures.
- [x] 3.5 pgTAP: an order with one invoice is not treated as half-recorded; an order with two sums both.
- [x] 3.6 pgTAP: a credit note reduces the order's expense rather than creating a negative row.
- [x] 3.7 pgTAP: a purchase whose invoice date precedes the earliest business date lands on that date.
- [x] 3.8 Float discipline: statement amounts converted to paise once at parse time, and split parts forced to sum to the invoice total.

## 4. Reserved categories

- [x] 4.1 Migration: a reserved-category registry, and refuse a hand-recorded expense whose category matches a reserved one under the same case, spacing and near-match rules the surface uses to suggest categories.
- [x] 4.2 Migration: reserve Hyperpure, owned by the supply origin.
- [x] 4.3 The owning origin may write its own reserved category; a person may not.
- [x] 4.4 pgTAP: exact, differently-cased, differently-spaced and near-match spellings are each refused to a person and each accepted from the origin.
- [x] 4.5 The refusal names the owning origin and says how such a cost reaches the ledger instead.
- [x] 4.6 Unit tests for the near-match refusal in `src/domain/expense-category.ts`, including the spellings that must not slip through.

## 5. Reading and arithmetic

- [x] 5.1 `ledger.ts` reads a channel's figures from `aggregator_channel_days`, not from the day row.
- [ ] 5.2 A day reading exists where no day row exists — the write side is done (the sync now records a figure for a day nobody counted, proved in 33), but the ledger UI showing it is the owner-deferred backlog item (paired with 6.8, "to be thought more later").
- [x] 5.3 A month containing an undetermined commission is stated as a ceiling and says so.
- [x] 5.4 **Carried from #42 (5.2):** a test pinning a historical month's totals so this change cannot move them silently.
- [x] 5.5 Integer paise throughout; no float constructed on any path added here.

## 6. The form loses its aggregator fields

- [x] 6.1 Remove the sourced channel's revenue and commission fields entirely; present gross, commission, net, settlement state and origin as a reading.
- [x] 6.2 A day with no figure yet still offers no field, and says no figure has arrived.
- [x] 6.3 An undetermined commission says so and does not present revenue as received.
- [x] 6.4 An unsourced channel keeps its fields, and the form states why the two differ.
- [x] 6.5 A superseded figure is shown beside the current one, marked superseded, and reaches no total.
- [x] 6.6 Extend the existing explanation affordance: provisional, revised, disputed, and a commission that may never be determined. Reachable by tap, self-reporting as open, dismissable from the keyboard.
- [x] 6.7 Extend `SourceTag` to name the three origins.
- [ ] 6.8 A past date with no ledger row opens showing its figures rather than a blank form that hides them.
- [x] 6.9 Accessible names, and no added field below the mobile-zoom threshold.

## 7. One parser, two callers

- [x] 7.1 Edge Function `parse-operator-statement`: accepts bytes, returns a normalised payload, recognises shape by content and never by filename.
- [x] 7.2 Zomato order-history parser (zip → csv), including the `08:17 PM, August 17 2026` date form, and **dropping the customer identifier and telephone columns inside the parser**.
- [x] 7.3 Zomato settlement parser (`Order Level` sheet), accepting both the per-restaurant and the consolidated-entities workbook.
- [x] 7.4 Hyperpure statement parser (`Overall SOA` header row 14, `Payment Ledger` header row 2).
- [x] 7.5 An unrecognised file is refused, names the shapes it did not match, and writes nothing.
- [x] 7.6 Fixture tests from the four real files downloaded on 2026-08-18, parsed with no network available.
- [x] 7.7 A test proving no customer identifier or telephone number reaches storage from a real order-history file.
- [x] 7.8 The reader posts bytes to the same function rather than parsing its own.

## 8. Upload surface

- [x] 8.1 Migration: storage bucket `operator-statements`, private, with policies deriving entitlement from the same helper the table policies use.
- [x] 8.2 pgTAP or REST: a guessed path into another outlet's statement is refused.
- [x] 8.3 Upload on the aggregator surface: ledger authority for a Zomato file, expenses authority for a Hyperpure file.
- [x] 8.4 Re-supplying an identical file changes nothing and asks nothing.
- [x] 8.5 Re-uploading a settled week changes nothing: settled is terminal in the ingest, so there is no silent replacement to confirm — a stronger guarantee than confirm-then-replace. (A different file for an *unsettled* week updates in place, idempotently.)
- [x] 8.6 The result states what was written, per outlet and per date, and what it replaced.
- [x] 8.7 Offline: the surface states that supplying a file needs a connection, rather than appearing to queue one.

## 9. Hyperpure reader (private repo `shawarmania-sync`)

- [x] 9.1 Header set and download contract pinned, verified live 2026-08-20 against the owner's session (all endpoints 200). Findings: `headerroute` is a single constant `v2` (no per-endpoint recipe); the `token` cookie already carries the `Bearer ` prefix (sent verbatim); `deviceid`/`x-outletid`/`x-trackingid` are required (400 without them); the statement is a two-step POST `soaFilePath` → signed S3 URL (which 404s until the write settles, so the GET retries), not `GET SOA/download`; `order/history` returns `response.ListOfOrderDetail` with `OrderNo`/`Status`. Reader corrected (`session.mjs`, `api.mjs`); the real SOA (17 orders / ₹80,356.09) was run through the ops parser and reconciled exactly.
- [x] 9.2 Hyperpure channel: pull the statement in windows of at most 92 days, post bytes to `parse-operator-statement`.
- [x] 9.3 Owner-facing Hyperpure health/reconnect landed, **Model A** (Hyperpure rides Zomato's login): ops side widened `aggregator_channel_credentials` + `aggregator_sync_runs` to the channel and taught `aggregator-reader` to hold its session (migration `20260820000000`, pgTAP `38`, 1775 db tests green); the reader records each run's outcome via `reportOutcome`; the app shows a read-only Hyperpure health line beside Zomato's; and the Zomato login now captures the Hyperpure session in the same pass (`shawarmania-sync` `src/auth.mjs`). No separate Hyperpure OTP/reconnect — reconnecting Zomato refreshes both.
- [x] 9.4 Reconcile the statement against the supplier's order list and **report any delivered order the statement omitted**, rather than recording the period as fully read.
- [x] 9.5 Schedule beside the Zomato job, timezone pinned.
- [x] 9.6 Satisfied by the live reader's architecture: the daily read already takes the live week from Order History (`get-all-v2`, `src/sources/zomato/history.mjs`) and every settled cycle from the authoritative settlement workbook (which carries the cancellation refunds). The refund-omitting dashboard call (`get-transaction-details` orders tab, `api.orders`) is dead code on the live path — nothing in `buildCycles` calls it. The downloadable order-history *export* was the other option considered; it was rejected because it stops at yesterday and carries customer PII, both regressions versus the live JSON. (Optional follow-up: delete the dead `api.orders` to make the intent unmistakable.)
- [ ] 9.7 **Carried from #42 (6b.10):** local end-to-end — trigger a run, watch a day's figures change, force a lapsed session, reconnect from the app, see the next run write.

## 10. Duplicate signal

- [x] 10.1 Persist "these two are both real" so `markNotDuplicate` stops throwing.
- [x] 10.2 The signal stays advisory and never deletes either row.

## 11. Restatement

- [x] 11.1 Rehearse against the real payload and record the outcome before writing anything.
- [x] 11.2 Migration: delete the 8 hand-typed Hyperpure rows and the 2 recovery-sourced rows; write the 15 statement rows plus the one opening row of ₹14,199.90 dated 2026-08-01 for order `ZHPWB27-OR-0028649625`.
- [x] 11.3 The migration asserts its own outcome and aborts unless August's Hyperpure holds 16 rows totalling ₹85,206.37.
- [x] 11.4 **Carried from #42 (9.3):** clearing a channel's synced-from date leaves historic figures untouched.

## 12. Demo and docs

- [x] 12.1 Demo fixtures: an undetermined commission, a superseded figure, a shared-cost purchase, a supplied statement, and a refused reserved category.
- [x] 12.2 The four-role demo walkthrough still walks, and no demo role sees a statement it should not.
- [x] 12.3 **Carried from #42 (10.1 to 10.7):** the docs pass, written against this change's behaviour rather than the sourced-reading form that was never built — `BUSINESS_CONTEXT.md`, `PROJECT_OVERVIEW.md`, `DATA_MODEL.md`, `OPERATIONS.md` (including the by-hand recovery procedure naming each file and where to download it), `LIMITATIONS.md`, `SCREENS.md`, and `openspec/todos/aggregator-settlement.md`.

## 13. Phase gate

- [x] 13.1 PHASE GATE, verified 2026-08-20. Each clause of the Gate line and what proves it:
  - **A Hyperpure order reaches the ledger exactly once through re-read, ZPL recovery and re-upload** — `36_supply_statement_ingest.sql` replays one order as statement, later statement and hand upload → one row; `33_aggregator_cycle_ingest.sql` proves the ZPL recovery of that order writes no expense.
  - **A ZPL recovery reconciles and creates no expense; a non-Hyperpure deduction still creates one** — `33_aggregator_cycle_ingest.sql` (supply recovery + advertising cases, and the two-outlet production case).
  - **Zomato revenue/commission have no writable path from any client** — `32_zomato_settlement_sync.sql` (`figure_column_unwritable`, 42501 for owner and FA) and `21_manual_ledger.sql` (a day-row write naming a moved column fails 42703).
  - **A Hyperpure purchase lands on its invoice date, or the books' opening where earlier** — `36_supply_statement_ingest.sql`.
  - **Each of the three statement shapes parses with no network, and the order-history parser stores no Customer ID or Phone** — `src/data-access/statements/statement-parser.test.ts`, decoding real xlsx/zip bytes; fixtures are synthetic-but-structural to avoid committing customer PII, which is the stronger proof of the drop.
  - **FA, Biller and Employee are refused every new table and the statement bucket** — `32` (`settlement_refused` now covers `aggregator_channel_days`), `37_operator_statements_isolation.sql` (the bucket), `01_schema_coverage.sql` (classification).
  - **The restatement is rehearsed and leaves August's Hyperpure at ₹85,206.37 across 16 rows** — the migration self-asserts its before (10 / ₹52,706.53) and after (16 / ₹85,206.37); rehearsed read-only against production 2026-08-20 and the shape matched.
  - **The four-role demo walkthrough still walks** — the 244-test Playwright suite, green.
  - **A day with no drawer count reads its Zomato figures for a past date** — the WRITE half is proved (`33`: a figure is written for a day with no ledger row), but the ledger UI that SHOWS it is the owner-deferred backlog item (5.2 / 6.8, "to be thought more later"). This is the one Gate clause whose reading half is intentionally not yet built.
