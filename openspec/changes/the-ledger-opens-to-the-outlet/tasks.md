## 1. Start from the post-#37 schema, not from main

- [ ] 1.1 Confirm `expense-categories-grow-from-use` (#37) is archived, or at minimum that its migration is applied locally, before writing a line of this one. This change's migration is written against the free-text category column and against policies #37 deliberately left alone.
- [ ] 1.2 Snapshot both manual-ledger tables from production before this change's migration is pushed, following the same procedure as #37's task 1.1. Two forward-only migrations land on these tables in consecutive changes.

## 2. Migration: the expense row grows the columns the new rules need

- [ ] 2.1 Leave `is_cash boolean` exactly as it is. No payment enum, no `pending` state, no settlement columns (design D4). If this task looks like an omission when you reach it, read D4 before adding any of them back.
- [ ] 2.2 Add `voided_at`, `voided_by`, `voided_reason`, with a completeness check in the shape of `attendance_override_complete`: all three null, or all three present with a non-blank reason. Settle the open question on whether the reason is required before writing the check.
- [ ] 2.3 Add `updated_by uuid` to both `manual_ledger_days` and `manual_ledger_expenses`.
- [ ] 2.4 `revoke delete on public.manual_ledger_expenses from authenticated`, following `20260726000010_grants_hygiene.sql` for how a grant change is written, and add a `reject_mutation()` delete trigger so a service-side mistake is refused too. Leave `manual_ledger_days` deletable (design D3).

## 3. Migration: guards for the rules a policy cannot express

- [ ] 3.1 Extend `manual_ledger_guard()` to set `updated_by = auth.uid()` on every update and to refuse a caller-supplied value, while leaving the existing `recorded_by` freeze intact (design D6).
- [ ] 3.2 Refuse any update to a row that is already voided, refuse a second void, and refuse an un-void.
- [ ] 3.3 Enforce the staff date rules in the guard rather than in a policy, since they compare `business_date` against the outlet's current business date through `app_business_date(now(), business_day_cutover)`: a staff insert only on the current business date, and a staff update or void only while the row's business date is still current. A Franchise Admin or Super Admin passes both unchanged.
- [ ] 3.4 Add **no** date predicate to any `select` policy. The two-business-day window is where the staff surface opens, not a boundary, and enforcing it would mean resolving each outlet's cutover per row to protect an expense row that is not a revenue figure (design D2).

## 4. Migration: the eight policies

- [ ] 4.1 Rewrite `manual_ledger_days` select, insert, update and delete: owner at any outlet, Franchise Admin at outlets from `app_outlets_for('franchise_admin')`. **No staff branch of any kind.** Keep `recorded_by = auth.uid()` on insert and keep it absent from update.
- [ ] 4.2 Rewrite `manual_ledger_expenses` select: owner, Franchise Admin at their outlets, and staff via `app_has_role_at('biller', outlet_id) or app_has_role_at('employee', outlet_id)`. Two clauses rather than one, so a change to either stays greppable.
- [ ] 4.3 Rewrite `manual_ledger_expenses` insert: same three branches, with `recorded_by = auth.uid()` retained for everyone.
- [ ] 4.4 Rewrite `manual_ledger_expenses` update: owner and Franchise Admin unrestricted at their outlets; staff only where `recorded_by = auth.uid()`. The current-day limit is the guard's job, not the policy's.
- [ ] 4.5 Drop the `manual_ledger_expenses` delete policy along with the grant. Seven policies are rewritten and this one is removed, which is why the count is eight.
- [ ] 4.6 Use `(select public.app_is_owner())` and `outlet_id in (select public.app_outlets_for(...))`, the planner conventions documented in `20260729000004_multi_outlet_people.sql`.

## 5. Isolation and write-contract tests

- [ ] 5.1 Rewrite `supabase/tests/21_manual_ledger.sql`. It currently asserts the opposite of the new rule in several places, so this is a rewrite rather than an extension. Keep its constraint coverage; replace its authority section.
- [ ] 5.2 Four roles × both tables × select, insert, update, delete, at their own outlet and at the other. **Silent over-permission passes every functional test in this repo**; this is the only thing that catches it.
- [ ] 5.3 Assert a Biller and an Employee are refused every verb on `manual_ledger_days` at their own outlet. Both directions are load-bearing: the write verbs protect the drawer, the read verb protects past days and month aggregates (design D5).
- [ ] 5.4 Assert a hand-crafted staff update of `cash_counted_paise`, `opening_cash_paise` and `cash_removed_paise` is refused, named individually rather than only as a blanket table refusal, because these three are the gate's claim.
- [ ] 5.5 Assert a staff insert against yesterday's business date is refused, and against today's succeeds.
- [ ] 5.6 Assert a staff select of an expense older than two business days **succeeds**. The window is a surface default and the database must not be quietly enforcing it (design D2).
- [ ] 5.7 Assert a staff update of somebody else's expense is refused, and of their own same-day expense succeeds.
- [ ] 5.8 Assert a staff update of their own expense dated before the current business date is refused, and that a Franchise Admin at that outlet can still correct the same row.
- [ ] 5.9 Assert a delete on `manual_ledger_expenses` is refused for every role, and that `manual_ledger_days` is still deletable by owner and manager.
- [ ] 5.10 Assert a void without a reason is refused, an edit of a voided row is refused, and a second void is refused.
- [ ] 5.11 Assert `updated_by` is set from the session on update and cannot be forged, while `recorded_by` stays frozen.
- [ ] 5.12 Assert ending an assignment ends that account's reach on the next request, for both the manager and the staff branches.

## 6. Generated types and the adapter seam

- [ ] 6.1 `npm run db:reset && npm run db:types`, inspect and stage `src/data-access/database.types.ts`.
- [ ] 6.2 Add void fields and `updatedBy` to `ManualLedgerExpense`, `NewManualLedgerExpense` and `ManualLedgerExpensePatch`. `isCash` is unchanged.
- [ ] 6.3 Replace `deleteExpense` with `voidExpense(id, reason)` on the adapter interface.
- [ ] 6.4 Implement in the Supabase adapter and the mock adapter, with fixtures typed from the regenerated schema types.

## 7. The arithmetic

- [ ] 7.1 `readDay` in `src/features/manual-ledger/ledger.ts`: expected cash subtracts expenses where `isCash && voidedAt === null`. Add a test for a voided drawer expense leaving expected cash untouched.
- [ ] 7.2 `readMonth`: exclude voided expenses from every figure, including the category breakdown.
- [ ] 7.3 Leave the profit basis wording alone. The month is still a cash basis because pending was cut (design D4), and `profit-estimates` requires the stated basis to be truthful, which it currently is. Changing it would make it wrong.

## 8. Extract the expense list, then mount it twice

- [ ] 8.1 Lift the expense list and its form out of `src/features/manual-ledger/ledger-day.tsx` into one component both surfaces mount (design D7). Behaviour-preserving for the day surface: the existing `manual-ledger-surface.test.tsx` assertions about the list should pass unchanged before any new surface exists.
- [ ] 8.2 Re-mount it in the day surface below the figures, and confirm the day surface's own tests still pass. Do this before building the staff tab, so a regression there is attributable to the extraction and not to new work.
- [ ] 8.3 Add `staff-expenses` gate registry entries under `biller` and `employee`, state `live`, each with a `nav` block. **The gate registry is on the `/quickfix` refusal list**, as are RLS and money, so this change runs the full local gate set including the Docker job.
- [ ] 8.4 Build `src/features/expenses/staff-expenses-surface.tsx` around the extracted component: the two most recent business days for the chosen outlet. No revenue, drawer, commission or monthly figure anywhere on it.
- [ ] 8.5 The collapsed row shows category, amount, a from-the-drawer marker, note and recorder. The expandable card holds timestamps and void reason and actor (design D8).
- [ ] 8.6 Record, correct and void actions, each shown only where the reader may perform it, with the database still the refusal.
- [ ] 8.7 `useOutletScope` for a staff member assigned at more than one outlet; a single-outlet person gets no control, as everywhere else.
- [ ] 8.8 A failed submit with no connection keeps everything typed and says so. **No queue** — `src/outbox/index.ts` is still `export {}` and the real one is #9's.
- [ ] 8.9 Shimmer shaped for this surface, since it is new.

## 9. The ledger surface for managers

- [ ] 9.1 Give `owner-manual-ledger` a Franchise Admin counterpart entry so the tab appears in the manager's shell, scoped by assignment.
- [ ] 9.2 Void in the ledger's own expense list, replacing the delete confirmation whose copy currently reads "Nothing records that it was ever here".
- [ ] 9.3 Voided rows struck through and clearly withdrawn, in both themes [owner, 2026-08-07].
- [ ] 9.4 The day and month readings name the correcting account where it differs from the recorder.
- [ ] 9.5 Reshape the ledger's shimmer where the layout moved.

## 10. Docs and the inherited obligation

- [ ] 10.1 `docs/ROLES_AND_PERMISSIONS.md` — the two manual-ledger rows in the capability matrix are owner-only on both lines and both change. Add the expense rows for staff.
- [ ] 10.2 `docs/SCREENS.md` — the staff expenses surface, and the Ledger's new readers.
- [ ] 10.3 `docs/DATA_MODEL.md` — void and attribution on the expense row, and that `is_cash` stays a boolean with the reason from D4 so the absence of a pending state reads as a decision.
- [ ] 10.4 `docs/LIMITATIONS.md` — the shared-tablet attribution degradation coming with #9; that a fabricated cash entry is not caught by the drawer count; that a credit purchase cannot be recorded at all; and the D5 distinction, that a worked shift's own takings are not confidential while past days, month aggregates, the other outlet and commission-net figures are.
- [ ] 10.5 `openspec/changes/daily-cash-live/proposal.md` — the carry-over obligation grows from amounts and dates to attribution and void state. Not settlement or payment states.

## 11. Verification

- [ ] 11.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [ ] 11.2 The Docker job in full: `db:start`, `db:reset`, `test:db`, `test:rls`, `test:e2e:auth`, `db:types`, then `git diff --exit-code src/data-access/database.types.ts`.
- [ ] 11.3 **`test:e2e:auth` specifically.** It asserts what each role lands on and the chrome around it, and this change adds a tab to two shells. `ui-owner-console-and-demo` broke it while every other gate stayed green.
- [ ] 11.4 Run the app and look at it as all four roles: phone and tablet viewports, light and dark themes, a voided row visible in each.
- [ ] 11.5 Sign in as a Biller and confirm by hand that the ledger tab is absent, that the staff expenses tab records against today, and that a hand-crafted read of `manual_ledger_days` returns nothing.

## 12. PHASE GATE

- [ ] 12.1 **Gate**: a Biller records a cash expense at their own outlet from their own phone and is refused yesterday's by the database; a Franchise Admin reads the full day and month at outlets they are assigned to and no others; a staff member is refused a past day's revenue, a month's aggregate and any alteration of a day's counted cash by the database, not by a hidden screen; and a voided expense stays visible, struck through, and stops counting.
