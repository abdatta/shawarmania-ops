## 1. Before anything is touched

- [ ] 1.1 Dump `manual_ledger_days` and `manual_ledger_expenses` from production to a file outside the repo, following the snapshot procedure already used for the pre-staff-as-accounts baseline; verify the dump restores into a scratch database and row counts match production exactly.
- [ ] 1.2 Establish the figures the carry-over must reproduce: each outlet's monthly cash and non-cash expense totals, each outlet's expense row count including voided rows, and each day row's counted cash; verify these are written into the change notes before any migration is drafted, because they are what the migration asserts against.
- [ ] 1.3 Confirm #11 has been in production use long enough for the owner to say so, and that the derived statement and the notebook have been compared on real trading days; verify the owner's go-ahead is recorded with its date.
- [ ] 1.4 Count how many `manual_ledger_days` rows carry a non-zero cash added, and settle open question 2 with that count in hand; verify the chosen modelling is written into `design.md` before the migration is drafted.
- [ ] 1.5 Settle open question 1 with the owner: whether a consumption basis is still wanted now that inventory is shelved; verify the answer is reflected in the `profit-estimates` delta before it is applied.
- [ ] 1.6 Settle open question 3: whether the archived day table stays in `public` with no grant or moves to a schema nothing reads; verify the decision is recorded.

## 2. Promote the expense record

- [ ] 2.1 Remove the single remaining reference to `public.expenses` in `src/data-access/supabase-adapters/expense-categories.ts` and confirm no other reader exists; verify a repository-wide search finds none and the type check passes with the reference gone.
- [ ] 2.2 Drop the empty `public.expenses`, having asserted in the same transaction that it holds zero rows; verify the assertion aborts the migration if any row exists.
- [ ] 2.3 Rename `manual_ledger_expenses` to `expenses`, carrying its policies, indexes, triggers, constraints and comments; verify no row is inserted or deleted, every identity is preserved, and the void, attribution and recorded-from-away columns arrive intact.
- [ ] 2.4 Re-point every adapter, query, mock and fixture at the promoted name; verify `npm run typecheck` passes and no code path names the old table.
- [ ] 2.5 Confirm the staff expense surface and the shared expense component behave identically after the promotion; verify a staff member still corrects only their own rows on the day they recorded them, and that a correction outside that window is still refused.
- [ ] 2.6 Regenerate `src/data-access/database.types.ts`; verify `npm run db:types` leaves no unexpected generated-type diff.

## 3. Carry the day rows across

- [ ] 3.1 Carry each `manual_ledger_days` row into a drawer observation marked legacy imprecise, placed at that outlet's cutover boundary for its business date; verify the marker is distinct from the ordinary approximate marker and that no fabricated time of day is stored or shown.
- [ ] 3.2 Carry cash removed into drawer cash out, as a spend where it had a reason and a collection where it did not; verify the reason survives and the instant matches the observation's.
- [ ] 3.3 Carry cash added by the modelling settled in task 1.4, retaining its original reason; verify the observation's arithmetic closes and the explanation is readable on the row.
- [ ] 3.4 Chain the carried observations so each opening is the previous one's carry-forward, and reconcile the chain against the notebook's stored openings; verify any disagreement is reported in the migration output rather than silently repaired.
- [ ] 3.5 Assert the reconciliation from task 1.2 inside the migration transaction, before anything is archived or dropped; verify a deliberately corrupted fixture aborts the whole transaction and leaves every source row untouched.
- [ ] 3.6 Assert attribution completeness inside the same transaction: every carried row has a recording account, every corrected row a correcting account, every voided row its reason; verify a row missing any of these raises rather than carrying across unattributed.

## 4. Archive, then remove

- [ ] 4.1 Rename `manual_ledger_days` to its archive name, read-only, with no client grant, per the decision from task 1.6; verify no policy grants any role access and no application code queries it.
- [ ] 4.2 Drop `daily_cash_records` and `cash_withdrawals`, having asserted zero rows in each within the same transaction; verify the assertion aborts if either holds a row, and that no drawer cash out was ever recorded there after #11 shipped.
- [ ] 4.3 Drop `close_business_day()`, `billing_assert_day_ready()`, `counter_shift_closed_day_guard()` and its trigger; verify no remaining function, trigger or policy references any of them and that a counter shift can still be opened on any date.
- [ ] 4.4 Drop `outlets.billing_live_from` with its guard function and triggers; verify no reader remains and that the Outlets form no longer offers a counter-billing start date.
- [ ] 4.5 Remove the manual ledger route, surface, adapters, mock fixtures and its entry in `src/gates/registry.ts`; verify the route no longer resolves in either mode and the four-role demo walkthrough still walks.
- [ ] 4.6 Confirm the migration's order matches design decision 6, with the archive before every drop; verify a review of the migration reads dump, promote, carry, assert, archive, drop, in that order.
- [ ] 4.7 Write and test a down-migration that restores the notebook's names and the dropped objects from the archive and the dump; verify it runs green against a scratch database restored from task 1.1, and record that it is not expected to be used.

## 5. Reporting and the loose ends this change settles

- [ ] 5.1 Apply the `profit-estimates` delta per task 1.5; verify the profit surface names one basis, presents a ceiling while any commission is undetermined, and offers no control implying a consumption basis exists.
- [ ] 5.2 Confirm the derived ledger covers every date the business has traded, from one reader; verify a date preceding an outlet's first bill renders through the same code path, marked legacy imprecise, and that no archived table is queried.
- [ ] 5.3 Reconcile August 2026 end to end after the migration: verify each outlet's month reads the same totals from the derived statement as the notebook held before it, and record the exact figures alongside the ones from task 1.2.
- [ ] 5.4 Close `openspec/todos/ledger-handover-per-outlet.md`, stating that the act it tracked became unnecessary rather than being performed; verify the reason is written into the closure so a future reader is not left guessing.
- [ ] 5.5 Close `openspec/todos/raw-materials-is-identified-by-a-word-nobody-types.md` as dissolved with the consumption basis; verify the closure names what dissolved it.
- [ ] 5.6 Review the remaining expense todos against the promoted table: `expense-payment-method-inherits-the-bill-enum.md` and `near-miss-category-matching-reaches-expenses.md` both named a change that no longer exists; verify each is either re-pointed at a real trigger or closed with a reason.

## 6. Docs, roadmap and gates

- [ ] 6.1 Update `docs/DATA_MODEL.md`, `docs/SCREENS.md`, `docs/LIMITATIONS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OPERATIONS.md`, `docs/DEMO_MODE.md` and `docs/TESTING.md`; verify no page still describes the manual ledger as a current surface, that `docs/LIMITATIONS.md` records the stopgap as discharged with the date, and that `docs/OPERATIONS.md` no longer instructs anybody to set an opening float or a counter-billing start date.
- [ ] 6.2 Amend the #12 row and the Wave E narrative in `openspec/changes/ROADMAP.md`, including the standing note explaining why #36 sits in Wave D; run `npm run roadmap:sync` and verify no hand-stamped status drift.
- [ ] 6.3 Read `.github/workflows/` and run every job it runs; verify the non-Docker and Docker-backed gates each pass with recorded evidence.
- [ ] 6.4 Walk both real shells and all four demo roles on a phone and a tablet in both themes; verify expenses, the drawer, the ledger, billing, attendance and the aggregator surfaces are all unaffected except where this change intended.
- [ ] 6.5 PHASE GATE — Retire the manual ledger: August 2026 reads from the derived statement with the same monthly totals, row counts and counted-cash figures the notebook held, asserted inside the migration so a mismatch aborts it whole; every carried row keeps its recording account, its correcting account, its void state and reason, and its recorded-from-away marker, proved row by row rather than in aggregate; a date before an outlet's first bill renders through the same reader as yesterday, marked as an hour that was never recorded rather than given a plausible time; the expense record is one table, promoted by rename with no row copied, and the empty one is gone; `daily_cash_records`, `close_business_day()`, `billing_assert_day_ready()`, the closed-day shift guard and `outlets.billing_live_from` are all dropped with no reader left behind; the notebook's route no longer resolves while its rows survive read-only under an archive name; a down-migration restores the previous estate from the dump and runs green against a scratch database; the handover and raw-materials todos are closed with their reasons stated; and the four-role demo walkthrough still walks.
