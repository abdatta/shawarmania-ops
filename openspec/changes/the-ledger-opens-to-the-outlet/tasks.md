## 1. Start from the post-#37 schema, not from main

- [ ] 1.1 Confirm `expense-categories-grow-from-use` (#37) is archived, or at minimum that its migration is applied locally, before writing a line of this one. This change's migration is written against the free-text category column and the nullable note, and against policies #37 deliberately left alone.
- [ ] 1.2 Snapshot both manual-ledger tables from production before this change's migration is pushed, following the same procedure as #37's task 1.1. Two forward-only migrations land on these tables in consecutive changes.

## 2. Migration: the expense row grows the columns the new rules need

- [ ] 2.1 Create `public.ledger_payment` as an enum of `from_drawer`, `from_bank`, `pending`. Do not reuse `public.payment_method`: it carries `swiggy` and `zomato`, which are revenue channels and cannot be ways an expense was paid (design D4).
- [ ] 2.2 Replace `manual_ledger_expenses.is_cash boolean` with `payment public.ledger_payment not null`, backfilling `true → from_drawer` and `false → from_bank`. Assert the converted row count inside the transaction.
- [ ] 2.3 Add `voided_at`, `voided_by`, `voided_reason`, with a completeness check in the shape of `attendance_override_complete`: all three null, or all three present with a non-blank reason.
- [ ] 2.4 Add `settled_on date` and `settled_by uuid`, with a check that both are null together, that neither is set unless `payment = 'pending'`, and that a voided row carries neither.
- [ ] 2.5 Add `updated_by uuid` to both `manual_ledger_days` and `manual_ledger_expenses`.
- [ ] 2.6 `revoke delete on public.manual_ledger_expenses from authenticated`, and add a `reject_mutation()` delete trigger so a service-side mistake is refused too. Leave `manual_ledger_days` deletable (design D3).

## 3. Migration: guards for the rules a policy cannot express

- [ ] 3.1 Extend `manual_ledger_guard()` to set `updated_by = auth.uid()` on every update and to refuse a caller-supplied value, while leaving the existing `recorded_by` freeze intact (design D6).
- [ ] 3.2 Refuse any update to a row that is already voided, and refuse a second void, an un-void and a settlement of a voided row.
- [ ] 3.3 Enforce the staff date rules in the guard rather than in a policy, since they compare `business_date` against the outlet's current business date through `app_business_date(now(), business_day_cutover)`: a staff insert only on the current business date, and a staff update or void only while the row's business date is still current. A Franchise Admin or Super Admin passes both unchanged.
- [ ] 3.4 Write `public.settle_manual_ledger_expense(p_expense_id uuid, p_from_drawer boolean, p_settled_on date, p_reason text)` as `security definer`, re-deriving the caller's authority from their own token. It marks the expense settled and, when settled from the drawer, **adds to** that settlement date's `cash_removed_paise` and extends `cash_removed_reason` rather than replacing either (design D5). Create the day row if none exists for that date.
- [ ] 3.5 Assert in that function that the expense's own business date row, if it exists, is left byte-for-byte unchanged. This is the rule #12 calls the subtlest in the system and it deserves an assertion, not a comment.

## 4. Migration: the six policies

- [ ] 4.1 Rewrite `manual_ledger_days` select, insert, update and delete: owner at any outlet, Franchise Admin at outlets from `app_outlets_for('franchise_admin')`. **No staff branch of any kind.** Keep `recorded_by = auth.uid()` on insert and keep it absent from update.
- [ ] 4.2 Rewrite `manual_ledger_expenses` select: owner, Franchise Admin at their outlets, and staff via `app_has_role_at('biller', outlet_id) or app_has_role_at('employee', outlet_id)`. Two clauses rather than one, so a change to either stays greppable.
- [ ] 4.3 Rewrite `manual_ledger_expenses` insert: same three branches, with `recorded_by = auth.uid()` retained for everyone.
- [ ] 4.4 Rewrite `manual_ledger_expenses` update: owner and Franchise Admin unrestricted at their outlets; staff only where `recorded_by = auth.uid()`. The current-day limit is the guard's job, not the policy's.
- [ ] 4.5 Drop the `manual_ledger_expenses` delete policy along with the grant.
- [ ] 4.6 Use `(select public.app_is_owner())` and `outlet_id in (select public.app_outlets_for(...))`, the planner conventions documented in `20260729000004_multi_outlet_people.sql`.

## 5. Isolation and write-contract tests

- [ ] 5.1 Rewrite `supabase/tests/21_manual_ledger.sql`. It currently asserts the opposite of the new rule in several places, so this is a rewrite rather than an extension. Keep its constraint coverage; replace its authority section.
- [ ] 5.2 Four roles × both tables × select, insert, update, delete, at their own outlet and at the other. **Silent over-permission passes every functional test in this repo**; this is the only thing that catches it.
- [ ] 5.3 Assert a Biller and an Employee are refused every verb on `manual_ledger_days` at their own outlet.
- [ ] 5.4 Assert a staff insert against yesterday's business date is refused, and against today's succeeds.
- [ ] 5.5 Assert a staff update of somebody else's expense is refused, and of their own same-day expense succeeds.
- [ ] 5.6 Assert a staff update of their own expense dated before the current business date is refused, and that a Franchise Admin at that outlet can still correct the same row.
- [ ] 5.7 Assert a delete on `manual_ledger_expenses` is refused for every role, and that `manual_ledger_days` is still deletable by owner and manager.
- [ ] 5.8 Assert a void without a reason is refused, an edit of a voided row is refused, a second void is refused, and settling a voided row is refused.
- [ ] 5.9 Assert settlement: a Biller settles a row recorded by somebody else, the settlement date's cash-out rises by exactly the amount, and **the expense's own business-date row is unchanged in every column**.
- [ ] 5.10 Assert two settlements on one date sum into one cash-out figure with both reasons present.
- [ ] 5.11 Assert `updated_by` is set from the session on update and cannot be forged, while `recorded_by` stays frozen.
- [ ] 5.12 Assert ending an assignment ends that account's reach on the next request, for both the manager and the staff branches.

## 6. Generated types and the adapter seam

- [ ] 6.1 `npm run db:reset && npm run db:types`, inspect and stage `src/data-access/database.types.ts`.
- [ ] 6.2 Replace `isCash: boolean` with the three-state payment on `ManualLedgerExpense`, `NewManualLedgerExpense` and `ManualLedgerExpensePatch`. Add void, settlement and `updatedBy` fields.
- [ ] 6.3 Replace `deleteExpense` with `voidExpense(id, reason)` on the adapter interface, and add `settleExpense(...)` and `listPending(outletId)`.
- [ ] 6.4 Implement in the Supabase adapter and the mock adapter, with fixtures typed from the regenerated schema types.

## 7. The arithmetic

- [ ] 7.1 `readDay` in `src/features/manual-ledger/ledger.ts`: expected cash subtracts expenses where `payment = 'from_drawer' and voidedAt === null`. Add tests for a voided drawer expense and a pending expense leaving expected cash untouched.
- [ ] 7.2 `readMonth`: exclude voided expenses from every figure; include pending on its own business date; expose a separate pending total.
- [ ] 7.3 Change the profit basis wording. `profit-estimates` requires a truthful basis and the current words claim a cash basis the month no longer has. Update `profitEstimate`'s caller and the surface text together.
- [ ] 7.4 Add a test proving a settlement recorded on a later date leaves the earlier day's reading unchanged in every field. This mirrors the database assertion in 3.5 at the domain layer.

## 8. The staff surface

- [ ] 8.1 Add `staff-expenses` gate registry entries under `biller` and `employee`, state `live`, each with a `nav` block. **The gate registry is on the `/quickfix` refusal list**, as are RLS and money, so this change runs the full local gate set including the Docker job.
- [ ] 8.2 Build `src/features/expenses/staff-expenses-surface.tsx`: the two most recent business days for the chosen outlet, plus every unsettled pending item whatever its age. No revenue, drawer, commission or monthly figure anywhere on it.
- [ ] 8.3 The collapsed row shows category, amount, a from-the-drawer marker, note and recorder. The expandable card holds timestamps, void reason and actor, and settlement history (design D8).
- [ ] 8.4 Record, correct, void and settle actions, each shown only where the reader may perform it, with the database still the refusal.
- [ ] 8.5 `useOutletScope` for a staff member assigned at more than one outlet; a single-outlet person gets no control, as everywhere else.
- [ ] 8.6 A failed submit with no connection keeps everything typed and says so. **No queue** — `src/outbox/index.ts` is still `export {}` and the real one is #9's.
- [ ] 8.7 Shimmer shaped for this surface, since it is new.

## 9. The ledger surface for managers

- [ ] 9.1 Give `owner-manual-ledger` a Franchise Admin counterpart entry so the tab appears in the manager's shell, scoped by assignment.
- [ ] 9.2 Void, settle and the three payment states in the ledger's own expense list and form, replacing the delete confirmation whose copy currently reads "Nothing records that it was ever here".
- [ ] 9.3 Voided rows struck through and clearly withdrawn, in both themes [owner, 2026-08-07].
- [ ] 9.4 The month view shows the pending total beside the profit figure, with the corrected basis wording.
- [ ] 9.5 The day and month readings name the correcting account where it differs from the recorder.
- [ ] 9.6 Reshape the ledger's shimmer where the layout moved.

## 10. Docs and the inherited obligation

- [ ] 10.1 `docs/ROLES_AND_PERMISSIONS.md` — the two manual-ledger rows in the capability matrix are owner-only on both lines and both change. Add the expense rows for staff.
- [ ] 10.2 `docs/SCREENS.md` — the staff expenses surface, and the Ledger's new readers.
- [ ] 10.3 `docs/DATA_MODEL.md` — the three payment states, void, settlement, and why settling writes a cash-out line rather than flipping a state.
- [ ] 10.4 `docs/LIMITATIONS.md` — the shared-tablet attribution degradation coming with #9, the merged cash-out line, and that a fabricated cash entry is not caught by the drawer count.
- [ ] 10.5 `openspec/changes/daily-cash-live/proposal.md` — the carry-over obligation grows from amounts and dates to attribution, void state, settlement state and payment state.

## 11. Verification

- [ ] 11.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [ ] 11.2 The Docker job in full: `db:start`, `db:reset`, `test:db`, `test:rls`, `test:e2e:auth`, `db:types`, then `git diff --exit-code src/data-access/database.types.ts`.
- [ ] 11.3 **`test:e2e:auth` specifically.** It asserts what each role lands on and the chrome around it, and this change adds a tab to two shells. `ui-owner-console-and-demo` broke it while every other gate stayed green.
- [ ] 11.4 Run the app and look at it as all four roles: phone and tablet viewports, light and dark themes, a voided row and a pending row visible in each.
- [ ] 11.5 Walk the settlement by hand: record a pending expense dated several days back, record and read that day, settle it from the drawer today, then re-read the original day and confirm every figure is identical.

## 12. PHASE GATE

- [ ] 12.1 **Gate**: a Biller records a cash expense at their own outlet from their own phone and is refused yesterday's by the database; a Franchise Admin reads the full day and month at outlets they are assigned to and no others; an Employee is refused every revenue, drawer and commission figure by a hand-crafted request, not by a hidden screen; a voided expense stays visible, struck through, and stops counting; and a pending expense counts in the month the day it is incurred while moving the drawer only on the day it is settled, leaving every already-counted day byte-for-byte unchanged.
