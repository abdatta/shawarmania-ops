## 0. Before Anything

- [x] 0.1 Read `design.md` end to end — especially **The owner's rule, stated exactly**, which is why the cutover and nothing earlier is the trigger, and **Rejected alternatives**, three of which the owner turned down personally in discussion (finish on shift end, Finish Day marks prepared, finish late-arriving paid orders on arrival).
- [x] 0.2 Read both spec deltas. `counter-billing` renames a requirement; implementing against the living spec alone would keep the Finish Day refusal.
- [x] 0.3 **Tests before implementation.** *(Partly honoured: the pgTAP file and the REST probe were written after the migration was drafted, so they were not seen failing against the old functions. The rewritten Finish Day case in `54_the_ticket_is_two_switches.sql` was seen failing first — against stale local data, not the rule — and passes on a clean reset.)* Every database rule in sections 1–3 is written as a failing pgTAP case before the migration that satisfies it.
- [x] 0.4 Reset the local database before trusting any DB gate — the container is shared and another session may reset it mid-run.

## 1. The Column And The Sweep, In The Database

- [x] 1.1 pgTAP first: a paid unprepared order on payment business date D is finished by `finish_paid_orders_at_day_change(p_now)` with `p_now` one second after the cutover ending D, and not by one second before; `prepared_at` equals the cutover instant exactly; `prepared_source = 'day_change'`.
- [x] 1.2 pgTAP: an order taken 03:55 on D and paid 04:05 (payment business date D+1) is not finished at the cutover ending D and is finished at the one ending D+1. `prepared_at >= paid_at` holds.
- [x] 1.3 pgTAP: running the sweep at cutover + 1 minute and, on a fresh copy, at cutover + 3 hours yields identical `prepared_at` and `prepared_source`.
- [x] 1.4 pgTAP: open and cancelled orders are untouched; a paid order already prepared by the counter is untouched; an order at another outlet with a different cutover is finished at its own cutover.
- [x] 1.5 pgTAP: the sweep writes no `billing_commands` row and leaves every `billing_end_of_day_confirmations` row valid.
- [x] 1.6 Migration: add `orders.prepared_source text` with a check of `('counter','day_change')` and a check that it is null exactly when `prepared_at` is null. Backfill `'counter'` on every row with a `prepared_at` **before** adding the pairing check, in the same migration.
- [x] 1.7 Find the helper that computes a shift's `expires_at` from a business date and the outlet's cutover; reuse it for the cutover instant. If none is shared, write one and make shift confirmation call it too, rather than writing the expression a second time.
- [x] 1.8 Write `public.finish_paid_orders_at_day_change(p_now timestamptz default now())`: `security definer`, `search_path = ''`, joins the order to its bill for `payment_business_date`, sets the transaction-local `app.billing_command` flag `billing_order_guard` honours, updates per D1, returns the count.
- [x] 1.9 Extend `billing_order_guard`'s column whitelists for a paid order so `prepared_source` may change alongside `prepared_at`, and nowhere else.
- [x] 1.10 Revoke execute on the function from `public`, `anon`, `authenticated` and `service_role`. Schedule it with `cron.schedule('day-change-finishes-paid-orders', '* * * * *', ...)`.
- [x] 1.11 Drop `public.backfill_prepared_history()`.
- [x] 1.12 Confirm with `explain` that the sweep's predicate uses `orders_pipeline_idx` on a database seeded with a realistic order count, and record the plan in the PR description. *(Done on the local stack with `enable_seqscan=off`, since the seed holds a handful of orders: the update reads `orders_pipeline_idx` filtered to `status = 'paid' and prepared_at is null`, then joins `bills_id_outlet_unique` and `outlets_pkey` by index.)*

## 2. Late Ticks And Unwinds, In The Database

- [x] 2.1 pgTAP first: a prepare command with command time 23:40 for an order the sweep finished at 04:00 is accepted, and the order reads `prepared_at = 23:40`, `prepared_source = 'counter'`.
- [x] 2.2 pgTAP: a prepare command whose time is later than the stamp is accepted with the order unchanged.
- [x] 2.3 pgTAP: a prepare command for a paid order with `prepared_source = 'counter'` is still refused `order_not_open`.
- [x] 2.4 pgTAP: an unpay created inside the edit window before the cutover and delivered after the sweep returns the order to open with both preparation columns null; an unpay on a counter-prepared order keeps its preparation as today.
- [x] 2.5 pgTAP: every counter prepare writes `prepared_source = 'counter'`; every reprepare clears both columns.
- [x] 2.6 Update `prepare_billing_order` and `unpay_billing_order` (latest definitions — find them with `grep -l "function public.prepare_billing_order"` across migrations and take the newest) per D5 and D6. Keep every authorization check ahead of the new branches, in their current order.
- [x] 2.7 Hand-crafted requests: `update orders set prepared_source = ...` from an authenticated person, an FA and a tablet session, and `rpc('finish_paid_orders_at_day_change')` from each client role, all refused. Add these to the RLS suite.

## 3. Finish Day, In The Database

- [x] 3.1 pgTAP first: `confirm_billing_end_of_day` succeeds on a date with a paid unprepared order and leaves that order unprepared; it still refuses `unresolved_operations` on a date with an open order.
- [x] 3.2 pgTAP: after that day is finished, a hand-crafted take-back, cancel-after-paid and tender correction on the still-unprepared order's bill are each refused. This is the existing *Nothing moves after the day is closed* guarantee, now exercised on the case the old refusal used to make impossible.
- [x] 3.3 Remove the `unresolved_preparation` branch from `confirm_billing_end_of_day`.

## 4. The App

- [x] 4.1 `src/features/counter/finish-day-sheet.tsx`: move `foodOwedCount` from the blockers to the advisories, worded *N order(s) is/are paid but not marked prepared — it/they will be marked prepared at HH:MM*, with the outlet's cutover from the tablet's outlet context. Finishing is offered when it is the only item. *(Done. The time shown is the shift's own expiry, which is the cutover ending its business day.)*
- [x] 4.2 Remove the client's handling of the `unresolved_preparation` refusal, or keep it inert if an older server could still send it during rollout — decide, and say which in the PR. *(Kept, documented as historical: the server never produces it now, but an exact replay of a Finish Day refused before #69 returns its stored receipt.)*
- [x] 4.3 Add `preparedSource` to the order type in `src/data-access/adapters.ts`, read it in the live adapter, and type it from the regenerated schema (`npm run db:types`; check the diff for stray telemetry lines). *(Types regenerated, diff clean. `preparedSource` deliberately not added to `BillingOrder`: no screen reads it — see design D8.)*
- [x] 4.4 Confirm the counter's offline projection renders an order the server reports as day-change-prepared exactly as a ticked one, and that a locally queued prepare for it does not draw a needs-attention item after delivery. *(Server side proved in pgTAP: the delivered tick is `accepted`, so the outbox resolves it and nothing reaches needs-attention. The counter renders the server's `prepared_at` whatever its source.)*
- [x] 4.5 Update `finish-day-sheet.test.tsx` for the advisory; do not delete a case to make it pass.

## 5. Demo Mode

- [x] 5.1 In `src/data-access/mock/billing.ts`, project D1 at read time over the demo clock: a paid unprepared mock order whose payment business date has ended returns prepared at that cutover with `preparedSource: 'day_change'`. *(Done; the demo holds an upfront payment beside its order until preparation, so the payment's date comes from the held payment where there is no bill yet. Proved by a mock test seen failing with the projection removed.)*
- [x] 5.2 Keep one paid unprepared order on the demo's current date so the Finish Day advisory is walkable, and confirm the demo trading day still reconciles. *(No fixture needed: any upfront payment rung in the walkthrough produces one.)*

## 6. Docs And Board

- [x] 6.1 `docs/DATA_MODEL.md` — `prepared_source` beside `prepared_at`, and the day change as the second way an order is prepared.
- [x] 6.2 `docs/SCREENS.md` — Finish Day: food owed on a paid order moves from the blockers list to the advisories, with its wording.
- [x] 6.3 `docs/OPERATIONS.md` — delete *Finish Day refuses and names an order that is paid but not prepared* and its `backfill_prepared_history()` follow-up; add the counting query from `design.md` D3 and how to confirm the cron job is running.
- [x] 6.4 `docs/OFFLINE_AND_SYNC.md` — a queued Prepared tick delivered after the cutover is accepted and supersedes the stamp; a queued take-back clears it.
- [x] 6.5 `docs/ARCHITECTURE.md` — the database's scheduled jobs, now two, and why neither is load-bearing for correctness.
- [x] 6.6 `docs/GLOSSARY.md` — *Order*: finished by the counter or by the day change.
- [x] 6.7 Correct every other first-read surface that says Finish Day refuses over a paid unprepared order (`grep -rn "paid but not" docs openspec/specs src`), not just the deep one. *(Also `docs/DEMO_MODE.md` and `docs/TESTING.md`. The living specs change at archive, when the deltas merge.)*
- [x] 6.8 Run `npm run roadmap:sync`. Never hand-stamp a status.

## 7. Verification

- [x] 7.1 Run what CI runs, from `.github/workflows/verify.yml` rather than from this list, including the Docker-backed database and RLS jobs, and read each job's output. *(2026-10-08, on a freshly reset local stack: lint, format:check, typecheck, functions:typecheck, contrast, build — all green; `npm test` 2,281 passed; `npm run test:db` 80 files, 3,135 passed; `npm run test:rls` 293 passed; `npm run test:e2e` 312 passed; `npm run test:e2e:auth` 35 passed; regenerated types match.)*
- [ ] 7.2 Walk it by hand on a counter viewport against the local stack: take and pay an order, leave it unprepared, open Finish Day and read the advisory, finish the day, confirm the order is still on the rail, then call the sweep with `p_now` past the cutover and watch it leave. *(Partly: walked in demo mode on a 1280×800 counter viewport — paid an order upfront, opened Finish Day, read the amber advisory naming 04:00 beside the red blockers. Not yet walked on the local stack with a real tablet session and a `p_now` sweep; the sweep itself is proved in `80_the_day_change_finishes_paid_orders.sql`.)*
- [ ] 7.3 Walk the offline case: tick Prepared with the backend stopped, run the sweep, restore the backend, and confirm the tick lands with the counter's time and no needs-attention item. *(Not walked by hand. The server half — a 23:40 tick delivered after the sweep is accepted and replaces the stamp — is proved in pgTAP; the hand walk through a stopped backend remains.)*

## 8. Phase Gate

- [ ] 8.1 **PHASE GATE.** A paid order nobody ticked Prepared leaves every counter rail at its outlet's business-day cutover on its own, recorded as prepared at that cutover and marked as finished by the day change rather than by a person, so one query counts how often it happens, where and on which days; the record is identical whether the sweep ran on the minute or an hour late; an unpaid open order is untouched; Finish Day no longer refuses over a paid-but-unprepared order and instead says it will be marked prepared at the cutover, while still refusing over an unpaid one; a Prepared tick queued offline before the cutover and delivered after it is accepted and replaces the day change's stamp with the counter's own time, never landing as needs-attention; a take-back delivered after the stamp clears it; no client role can write the new column or run the sweep, proved by a hand-crafted request; `backfill_prepared_history()` is retired; and the four-role demo walkthrough still walks.
