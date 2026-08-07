## 1. Snapshot production before anything forward-only runs

- [ ] 1.1 Dump `manual_ledger_days` and `manual_ledger_expenses` from production to `C:\Users\iamro\shawarmania-prod-snapshots\<date>-pre-free-text-categories\`, following the 2026-07-29 pre-deploy snapshot procedure. Nine expense rows and twelve day rows are the only record of August 2026 trading, and `migrate` is forward-only.
- [ ] 1.2 Record in that folder the distinct category values the migration is expected to seed (`Hyperpure`, `Chicken`, `Staff Food`) and the expected converted row count (9), so the migration's own assertions can be checked against something written down beforehand.

## 2. The shared normalisation rule, before anything depends on it

- [ ] 2.1 Add `normalizeCategory` to `src/domain` (trim, collapse internal whitespace runs to one space, preserve case) with unit tests covering leading, trailing, repeated internal, tab and non-breaking whitespace, and a value already normalised.
- [ ] 2.2 Add a matching SQL immutable function `public.normalize_expense_category(text)` with the identical rule, so the database and the client cannot disagree. Test both against the same table of inputs.

## 3. Migration: the categories table

- [ ] 3.1 Create `public.expense_categories` (id, name text not null, created_by, created_at) with a not-blank check, a check that `name = normalize_expense_category(name)`, and a `unique` index on `lower(name)` so case cannot mint a duplicate.
- [ ] 3.2 Enable RLS and write its policies. Business-wide, no outlet clause, following the `customers` (#32) precedent: select for any active account, insert for any account that may record an expense. **Write the insert predicate for the eventual reader set, not just today's owner-only expense policies**, so #38 widens the expense tables without revisiting this one.
- [ ] 3.3 Create `public.expense_category_operations` (id, operation, name_before, name_after, ledger_rows_moved, expense_rows_moved, performed_by, performed_at), owner-only select and insert. Its own table, because a merge deletes one of its inputs and a column on the category row cannot survive the operation it describes (design D4).
- [ ] 3.4 Grant hygiene: no client `update` or `delete` on `expense_category_operations`, matching the rule in `20260726000010_grants_hygiene.sql`.

## 4. Migration: both expense tables come off the enum

- [ ] 4.1 Add a `text` category column to `manual_ledger_expenses`, backfill it from `normalize_expense_category(description)` on all nine rows, then drop the enum column and rename. Discard the enum values (design D8).
- [ ] 4.2 Seed `expense_categories` from the distinct backfilled values.
- [ ] 4.3 Assert inside the same transaction: nine rows converted, zero rows with a blank or unnormalised category, three categories seeded. Raise and roll back on any mismatch, so a partial conversion cannot commit.
- [ ] 4.4 Make `manual_ledger_expenses.description` nullable, keep its not-blank-when-present check, and leave every existing value in place. It is the Note now (design D6).
- [ ] 4.5 Convert `public.expenses.category` to `text` with the same not-blank and normalised checks. Empty table, zero rows to backfill, and the assertion should say so rather than assume it.
- [ ] 4.6 Drop the `public.expense_category` type once neither table references it.
- [ ] 4.7 **Touch no policy on `manual_ledger_expenses` or `expenses`.** #38 rewrites all six of them and the two migrations must not overlap (design, Context).

## 5. Migration: rename, merge and retire as database operations

- [ ] 5.1 Write `public.rename_expense_category(p_from text, p_to text, p_rewrite_history boolean)` as `security definer`, re-deriving Super Admin authority from the caller's own token rather than from an argument. Update the category row, and when rewriting history update both expense tables, in one transaction.
- [ ] 5.2 Write `public.merge_expense_category(p_from text, p_into text)`: rewrite both expense tables from A to B, delete A, all in one transaction.
- [ ] 5.3 Both write exactly one `expense_category_operations` row with per-table moved counts. Both return those counts so the surface can report what happened.
- [ ] 5.4 Write `public.retire_expense_category(p_name text)`: remove from suggestions only, touch no expense row, write no operation row.
- [ ] 5.5 Revoke execute from `public` and `anon` on all three; grant to `authenticated`.

## 6. Isolation and write-contract tests

- [ ] 6.1 New `supabase/tests/22_expense_categories.sql`. `expense_categories` is business-wide, so the isolation claim is different from every outlet-scoped table: assert a Franchise Admin, Biller and Employee at either outlet read the same list, and that a deactivated account reads nothing.
- [ ] 6.2 Assert the case-insensitive unique index refuses a second `chicken` when `Chicken` exists, by hand-crafted insert.
- [ ] 6.3 Assert the normalised check refuses `'  Chicken  '` and `'Staff  Food'` by hand-crafted insert.
- [ ] 6.4 Assert a blank category is refused on both `manual_ledger_expenses` and `expenses` by hand-crafted insert.
- [ ] 6.5 Assert a non-owner is refused `rename_expense_category` and `merge_expense_category`, and that neither expense table changed afterwards.
- [ ] 6.6 Assert a merge rewrites both expense tables and leaves exactly one operation row readable after the merged-away category is gone.
- [ ] 6.7 Assert retire removes the suggestion, changes no expense row, and writes no operation row.
- [ ] 6.8 Update `supabase/tests/01_schema_coverage.sql` for the two new tables.
- [ ] 6.9 Update `supabase/tests/21_manual_ledger.sql` where it asserts on the enum category or on a required description.

## 7. Generated types and the adapter seam

- [ ] 7.1 `npm run db:reset && npm run db:types`, then inspect and stage `src/data-access/database.types.ts`. `typecheck` cannot detect a stale snapshot; the CI diff check is the gate.
- [ ] 7.2 Replace `ExpenseCategory` with `string` on `ManualLedgerExpense`, `NewManualLedgerExpense` and `ManualLedgerExpensePatch`; make `description` nullable and rename the field to `note` through the adapter interface.
- [ ] 7.3 Add an `ExpenseCategoriesAdapter` to `src/data-access/adapters.ts`: `list()`, `rename(from, to, rewriteHistory)`, `merge(from, into)`, `retire(name)`, `listOperations()`. Wire it into `DataAdapters`.
- [ ] 7.4 Implement the Supabase adapter, and the mock adapter with fixtures typed from the regenerated schema types.
- [ ] 7.5 Delete `LEDGER_CATEGORIES` and `CATEGORY_WORDS` from `src/features/manual-ledger/ledger.ts` and every reference to them.

## 8. The month must group by the normalised stored text

- [ ] 8.1 Change `groupExpensesByCategory` in `src/features/manual-ledger/ledger.ts` to group by `normalizeCategory(expense.category)` rather than by an enum value.
- [ ] 8.2 Add a test proving two rows whose categories differ only in case or spacing total as one line. **This is the deliverable the gate names**; suggestions without this is the visible half of the change.
- [ ] 8.3 Add a test proving the month's expenses-by-category total still reconciles exactly against the profit estimate's expense subtraction, which the existing spec requires.

## 9. The typed category field

- [ ] 9.1 Build a suggest-on-focus, filter-as-you-type category input as a shared component: opens its suggestions on focus, filters case-insensitively as typed, accepts a value not in the list, reachable and dismissable from the keyboard, and with an accessible name that identifies the field.
- [ ] 9.2 Font size at or above the threshold where a mobile browser zooms the viewport on focus, as the manual-ledger spec already requires of every entry field.
- [ ] 9.3 Wire it into the ledger's expense form, replacing the `<select>`. Relabel "What was it for" to "Note (optional)" and stop requiring it.
- [ ] 9.4 Wire it into the demo-gated `src/features/expenses/expenses-surface.tsx` so the two surfaces do not diverge.
- [ ] 9.5 Soft warning on the double-counting phrases (aggregator commission, cash banked, owner drawing): dismissable, states where the figure belongs, never blocks (design D5).

## 10. The curation surface

- [ ] 10.1 Add an `owner-expense-categories` entry to `src/gates/registry.ts`, state `live`, **no `nav` block** — reached from the Ledger's month view beside the expenses-by-category breakdown (design D9). The gate registry is on the `/quickfix` refusal list, so this change runs the full local gate set including the Docker job.
- [ ] 10.2 Build the surface: each category with its usage count, and rename, merge and retire.
- [ ] 10.3 Rename and merge state the row count they are about to move, per table, before running. Neither offers an undo.
- [ ] 10.4 Show the operations log on the same surface, so a changed month is explicable.
- [ ] 10.5 Reshape the shimmer for the month view and the new surface in this change, since the layout moves.

## 11. Docs and spec deltas

- [ ] 11.1 `docs/DATA_MODEL.md` — the free-text category model, the snapshot rule and why there is no foreign key, and the business-wide table alongside `customers`.
- [ ] 11.2 `docs/SCREENS.md` — the curation surface and the changed expense form.
- [ ] 11.3 `docs/ROLES_AND_PERMISSIONS.md` — who may mint a category and who may curate.
- [ ] 11.4 `docs/LIMITATIONS.md` — the three double-counting categories are a warning now, not a guarantee, with the reason.
- [ ] 11.5 Update `openspec/changes/daily-cash-live/proposal.md`: its inherited obligation says the carry-over needs "no translation table" because both sides share the enum. Both sides now share free text, so the sentence needs restating rather than deleting.

## 12. Verification

- [ ] 12.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, `npm run test:e2e`.
- [ ] 12.2 The Docker job in full: `db:start`, `db:reset`, `test:db`, `test:rls`, `test:e2e:auth`, `db:types`, then `git diff --exit-code src/data-access/database.types.ts`.
- [ ] 12.3 Run the app and look at it: phone and tablet viewports, light and dark themes, the ledger expense form and the curation surface.
- [ ] 12.4 Rehearse the migration against a copy of the production snapshot from 1.1 before pushing, and confirm the assertions in 4.3 fire on a deliberately broken input.

## 13. PHASE GATE

- [ ] 13.1 **Gate**: a category typed once at one outlet is offered from then on at both; the month groups by the text the row stored, so a rename reaches new rows only until the owner deliberately rewrites history; a merge collapses two spellings across every past month and its log says what it moved; the nine production rows arrive carrying `Hyperpure`, `Chicken` and `Staff Food` as their categories with the note left free for detail; and neither `manual_ledger_expenses` nor `expenses` still reads the enum.
