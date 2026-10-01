# Tasks: staff-see-only-what-leaves-the-drawer

## 1. Pin the database rule before writing it (design D1, D2)

- [x] 1.1 `supabase/tests/67_staff_see_only_what_leaves_the_drawer.sql` (next free
  number at the time of writing; take the next one if it is gone). Seed one outlet
  day holding a cash purchase, a non-cash Salary by the owner, and a Hyperpure row
  (`source_system`, no recorder). As a Biller, an Employee and a tablet with a live
  shift, assert the cash row **is** returned and the other two **are not**, by
  id. Assert the same for the other outlet's rows (still nothing). Assert a manager and
  the owner still read all of them. (A person cannot hold two live roles at one
  outlet, `assignments_one_live_per_person_outlet`, so there is no manager-who-bills
  case.) Run it red against the current schema: 9 failures, all the new rule.
- [x] 1.2 In the same file: a staff INSERT with `is_cash = false` is refused with
  the D2 sentence (`42501`); a tablet INSERT likewise; a Biller UPDATE flipping
  their own running-day cash row to non-cash is refused and the row is unchanged;
  owner and manager non-cash INSERTs still succeed.
- [x] 1.3 Drawer invariance: `drawer_cash_expenses_paise()` called as the manager
  equals the sum of every cash expense at the outlet, including the rows staff
  recorded. A single pgTAP run cannot straddle the migration, so the assertion is
  the invariant itself rather than a before/after pair.
- [x] 1.4 `npm run test:rls`: a hand-crafted REST `select` on `expenses` as a staff
  session returns no non-cash row. Add it beside the existing expense isolation
  case rather than in a new suite.

## 2. The migration (design D1, D2)

- [x] 2.1 `supabase/migrations/<timestamp>_staff_see_only_what_leaves_the_drawer.sql`:
  recreate `expenses_select`, `expenses_insert` and `expenses_update` with `is_cash`
  on the counter and staff branches only, owner and manager branches byte-identical.
  Header comment states the owner decision, the production figures from the
  proposal, and that it reverses #38 D2.
- [x] 2.2 Replace `expense_guard()` adding the staff/counter non-cash refusal after
  `v_operator` and `v_is_staff` are resolved; every other clause unchanged. Diff
  the new body against `pg_get_functiondef` from a reset database before
  committing.
- [x] 2.3 Update the existing assertions that encode the old rule
  (the full `test:db` run surfaced `02_isolation_matrix.sql`,
  `03_status_and_scope.sql` and `14_assignments.sql`, each counting the seed's
  non-cash rows as staff-readable; `rls-probes.test.ts` counted five for the
  two-outlet employee). Also corrected the seed's comment claiming the owner's
  remote entries cannot be cash. Name each in the commit; never widen the new predicate to pass
  one.
- [x] 2.4 `npm run db:reset && npm run test:db && npm run test:rls`, in that order,
  on a freshly reset stack (the container is shared; re-reset if another session
  touched it). `npm run db:types` and confirm `database.types.ts` is unchanged (no
  column changes in this migration).

## 3. Demo mode (design D5)

- [x] 3.1 `src/data-access/mock/expenses.ts`: for `isStaff`, `listExpenses` and
  `listRecentExpenses` drop non-cash rows; `createExpense`/`updateExpense` with
  `isCash: false` throw `ExpenseActionError('refused', …)` with the D2 sentence;
  updating or withdrawing a non-cash row a staff session cannot read answers
  `not_found`, as the policy would.
  Test in `src/data-access/mock/expenses.test.ts` (create it if absent) against
  the existing fixtures.

## 4. The form (design D3)

- [x] 4.1 Tests first in `outlet-expenses-surface.test.tsx` and the counter shell's
  expense test: the staff form renders no **Paid with** field and records
  `isCash: true`; the full-reach form opens with *Choose…*, refuses to submit
  without a choice (no adapter call), and a correction opens on the row's own
  method.
- [x] 4.2 `src/features/expenses/expense-list.tsx`: `ExpenseDraft.isCash` becomes
  `boolean | null`, `BLANK_EXPENSE` per viewer (`true` for staff, `null` for full
  reach); hide the select and show *Cash, out of the drawer.* for staff; add the
  disabled *Choose…* option and the submit refusal for full reach.
- [x] 4.3 Confirm the counter's queued expense envelope is byte-identical in shape
  (`src/outbox/expense-queue.ts`, `supabase-adapters/billing.ts`); its tests stay
  green untouched.
- [x] 4.4 Reshape the form's shimmer only if the staff form's height changed. No
  shimmer to reshape: the form lives in a sheet that opens on demand, and the list
  it sits under is unchanged.

## 5. The record

- [x] 5.1 Correct the code comment at `outlet-expenses-surface.tsx` ("hiding an
  expense row protects nothing"). The migration comments that say it are history
  and stay as written.
- [x] 5.2 `docs/ROLES_AND_PERMISSIONS.md`: matrix rows *Read the outlet's
  expenses* / *Record* / *Correct* say "cash only" for Biller and Employee; rewrite
  the "everyone at the outlet reads every row" paragraph.
- [x] 5.3 `docs/SCREENS.md`: the staff Expenses paragraph (window, and the claim
  that hiding protects nothing), the counter's three-field form, the owner and
  manager's unchosen method. Also corrected the owner-remote paragraph, which
  described a no-cash form that never shipped.
- [x] 5.4 `docs/LIMITATIONS.md`: the "expense record to everyone at the outlet"
  sentence; a bound saying staff see cash salary advances and category names by
  decision (owner, 2026-10-01).

## 6. Verify

- [x] 6.1 Every gate in `.github/workflows/verify.yml`, including the Docker job
  and `test:e2e:auth` (the counter and staff shells are role indexes).
- [x] 6.2 In the browser, demo mode: as the Biller the Expenses screen and counter
  show cash rows only and a three-field form; as the owner the form starts on
  *Choose…*; phone and tablet viewports, light and dark.
- [x] 6.3 Commit locally. **Do not push**: the owner picks the deploy window, and
  the push is the release.

## 7. PHASE GATE

- [ ] 7.1 The Wave E checkpoint for #65, as written in ROADMAP.md: staff and a
  live counter read only cash expenses, proved by hand-crafted request; staff and
  the counter are refused any non-cash write with the sentence; the drawer is
  unchanged; the staff form has three fields; the owner and manager form starts
  unchosen and refuses to save unchosen; the four-role demo walkthrough walks.
  Archive only after it has run in production and the owner calls it.
