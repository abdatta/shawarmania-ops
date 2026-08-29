## 0. Read before writing

- [ ] 0.1 Read this change's `design.md` end to end, plus `openspec/specs/cash-drawer/spec.md`. Four things a fresh session gets backwards: the breakdowns partition **the interval**, never the calendar day (D1); the groups must be computed by the same SQL as the tile so they cannot disagree (D2); deleting the two buttons is what makes the three tiles complete, not tidiness (D5); and moving a count's instant **must** recompute its expected total (D6).
- [ ] 0.2 Read `supabase/migrations/20260827000001_cash_is_counted_not_closed.sql` sections 8 and 11, and `20260828000000_expenses_are_read_where_they_are_written.sql`. The new readers are siblings of the three that exist and must match their interval convention, their `security definer` posture and their `app_may_reach_drawer()` guard.

## 1. The grouped readers

- [ ] 1.1 One migration. Add `drawer_cash_receipts_by_day(p_outlet_id uuid, p_from timestamptz, p_to timestamptz)` returning `(business_date date, paise bigint, bills int)`, grouping `bills` joined to `effective_bill_payments` by `app_business_date(b.paid_at, o.business_day_cutover)` read from the outlet's own row. Same `(p_from, p_to]` convention, same `app_may_reach_drawer()` guard, `security definer`, `set search_path = ''`.
- [ ] 1.2 Add `drawer_cash_expenses_by_day(...)` returning `(business_date date, paise bigint, rows int)` over `effective_expenses` where `is_cash`, grouped by `app_business_date(coalesce(x.occurred_at, x.created_at), o.business_day_cutover)`. Same guard and convention.
- [ ] 1.3 Revoke from `public`, grant to `authenticated`, as the existing three do. Verify a Biller session calling either against an outlet they hold no assignment at is refused, by hand-crafted request, in `supabase/tests/`.
- [ ] 1.4 A database test asserting each grouped reader sums to its scalar sibling over the same interval, including an interval that spans a cutover. **This is the assertion the design exists to make possible** (design D8).
- [ ] 1.5 Regenerate `src/data-access/database.types.ts`; verify `npm run db:types` leaves no unexpected diff.

## 2. The state the surface reads

- [ ] 2.1 Add `receiptsByDay` and `cashExpensesByDay` to `DrawerState` in `src/data-access/adapters.ts`, newest first, each row carrying its business date, its paise and its row count. Document that the oldest may be partial and that its sum equals the corresponding scalar.
- [ ] 2.2 Wire both in `src/data-access/supabase-adapters/cash-drawer.ts` alongside the three existing `rpc` calls.
- [ ] 2.3 `cashReceiptsSinceCount` becomes the sum of `receiptsByDay[].bills`, and `cashExpensesSinceCount` the sum of `cashExpensesByDay[].rows`. Delete the `nearbyCashBills.filter(...)` derivation and the hardcoded `0`. **Do not change `nearbyCashBills` itself** — its cap is deliberate and serves the movable boundary (design D2).
- [ ] 2.4 Delete `const CUTOVER = '04:00'`. `daysCovered` derives from the grouped rows, which already carry the outlet's own cutover.
- [ ] 2.5 Mirror all of it in the mock adapter, so the demo seam cannot disagree with production. The two-expense-tables trap is what happens when it does.
- [ ] 2.6 Carry `occurredAt: string | null` onto `ManualLedgerExpense` and map it, so the client's interval filter uses the same `coalesce` the SQL does (design D3).

## 3. Cash from Bills opens a day-by-day reading

- [ ] 3.1 Make the `Cash from Bills` figure a control that opens a breakdown, and give the tile an affordance that says so. It must read as openable without a second icon per tile.
- [ ] 3.2 Render the groups newest first: business date, cash total, bill count. `Today` for the current business date; a group only partly inside the interval reads `28 Aug · since the count at 11:23 pm`, naming the count that bounds it; a whole group carries no qualifier (design D1).
- [ ] 3.3 State the interval total in the breakdown and assert in a test that it equals the tile.

## 4. Cash Expenses opens the expense list, by day

- [ ] 4.1 Same treatment for the `Cash Expenses` tile.
- [ ] 4.2 One `ExpenseList` per business date group, heading = the group's label, `businessDate` = that group's date, `showDates` off, `viewer.mayTouchAnyRow` **true** — the drawer surface is already gated by `app_may_reach_drawer()`, so nobody who cannot correct an expense can open this. Do not copy the reach expression from `outlet-expenses-surface.tsx`; it answers a different question for different readers (design D4).
- [ ] 4.3 Rows are the interval's rows: filter by `coalesce(occurredAt, createdAt) > lastCountedAt`. Today's group renders even when empty so there is always somewhere to add; past groups render only where the interval holds rows.
- [ ] 4.4 A partial group states, in muted text under its heading, how many earlier expenses that day it is not listing and that the earlier count settled them. Counted, never listed (design D3).
- [ ] 4.5 Non-cash rows are listed and marked as they already are, and excluded from the group subtotal.
- [ ] 4.6 `onChanged` reloads the drawer state, so adding an expense moves `expectedNowPaise` without a manual refresh.

## 5. Only Collect and Other Spend leave the surface

- [ ] 5.1 Delete both buttons and both movement sheets from `src/features/cash/cash-drawer-surface.tsx`, with the state and handlers only they used. `submitCount` is untouched — it already hardcodes `kind: 'collection'`.
- [ ] 5.2 Do **not** touch `drawer_cash_out`, its policies, its constraints, its grants, or `record_cash_out`. No migration in this task. Leave `recordCashOut` on the adapter with a comment saying it is unreachable from the app, why, and that re-offering a spend is a control rather than a migration (design D5).
- [ ] 5.3 Leave the Ledger's month `spends` card alone. It is already guarded by `month.spends.length > 0` and will simply never fire; a historical spend must stay readable.
- [ ] 5.4 No fourth tile. Deleting these removes the term it would have shown.
- [ ] 5.5 Update the drawer surface's own doc comment: the escape-hatch reasoning it currently carries for these two controls is now history, and the file should say what replaced it and why.

## 6. The newest count becomes editable in full

- [ ] 6.1 `edit_drawer_observation` gains `p_counted_at timestamptz`. Where it differs from the stored instant, recompute `expected_paise` by **calling** `drawer_cash_receipts_paise`, `drawer_cash_expenses_paise` and `drawer_cash_out_paise` over `(previous observation's instant, p_counted_at]`, excluding this observation's own movements — the same three, in the same order, as `record_drawer_observation`. Never reimplement the arithmetic (design D6).
- [ ] 6.2 Recompute `difference_paise` against the new expected total, staying null on an anchor.
- [ ] 6.3 Bound the moved instant exactly as recording bounds it: not in the future, strictly later than the preceding observation, not before the outlet's earliest drawer activity, each refusal naming what it collided with. The existing later-observation lock still runs first.
- [ ] 6.4 Stop the note defaulting to null. The adapter passes the note it holds; an edit that does not change the note leaves it as it was. **This is a live bug** — every amount edit currently wipes the note.
- [ ] 6.5 The edit sheet grows a note field and the same movable-boundary control the count sheet carries, and states what moving it did, rendered from `expectedAtInstant` in `src/features/cash/drawer-arithmetic.ts`. No second implementation, and `countAdvice.suggestedInstant` stays null with its test intact.
- [ ] 6.6 Reshape the edit sheet's shimmer if its height changed — a placeholder that no longer matches what arrives makes the surface reflow twice (`docs/DESIGN_SYSTEM.md`).

## 7. Pin it

Each of these must be **proved to fail on the tree before the fix**.

- [ ] 7.1 Both breakdowns sum to their tiles, over an interval spanning a cutover. Arithmetic, not a screenshot (design D8).
- [ ] 7.2 A count at 11:23 pm on 28 Aug with bills either side: the 28 Aug group holds only what came after, and its heading names the count.
- [ ] 7.3 An interval crossing the cutover at an outlet whose cutover is **not** 04:00 groups the small hours into the earlier business date. This fails if the constant is ever reintroduced.
- [ ] 7.4 `cashReceiptsSinceCount` with more than twelve cash bills in the interval reports the true number.
- [ ] 7.5 Adding an expense from a past group writes that business date and moves `expectedNowPaise` by that amount on reload.
- [ ] 7.6 A partial expense group states the count of earlier expenses it is not listing.
- [ ] 7.7 Neither Only Collect nor Other Spend renders, and `recordCashOut` is called from nowhere under `src/`.
- [ ] 7.8 Editing the newest count's instant earlier recomputes its expected total and difference; editing only the amount leaves the expected total **and the note** as they were.
- [ ] 7.9 Dismissing the Add form inside the breakdown leaves the breakdown open (design D7). Do not chase Escape — see `src/components/ui/modal.tsx`.
- [ ] 7.10 A Biller and an Employee are still refused every drawer read and write, including both new readers, by hand-crafted request.

## 8. Documentation and the roadmap

- [ ] 8.1 Sync this change's `cash-drawer` delta into `openspec/specs/cash-drawer/spec.md` on archive.
- [ ] 8.2 Update `docs/SCREENS.md` for the drawer's two lost controls and two new readings, and `docs/DATA_MODEL.md` for the grouped readers.
- [ ] 8.3 Record in `docs/LIMITATIONS.md` that the app no longer records a standalone collection or any spend, that the record still carries both, and the owner's reason [owner, 2026-08-29].
- [ ] 8.4 No ROADMAP.md row, number or wave. Owner feedback plus two walked-past clauses in `cash-drawer`; not new product.

## 9. Gate

- [ ] 9.1 Read `.github/workflows/` and run every job it runs, including the Docker-backed database ones. Not a checklist from docs.
- [ ] 9.2 Walk the drawer on a phone in both themes, at both outlets: open both breakdowns, add an expense to a past group, fix the newest count's time.
- [ ] 9.3 **Gate:** every term in "In the drawer now" is reachable from the figure that states it; both breakdowns reconcile to their tiles, asserted; the standalone collection and spend are gone from the surface while the record keeps both; and the newest count is editable in full, its instant included, with its expected total recomputed from the instant it moved to.
