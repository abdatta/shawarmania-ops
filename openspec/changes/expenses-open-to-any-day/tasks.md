## 1. Ask the session one question, once

- [ ] 1.1 Rename `src/features/expenses/staff-expenses-surface.tsx` to `outlet-expenses-surface.tsx` and `StaffExpensesSurface` to `OutletExpensesSurface`. Update the three import sites (`src/routes/surfaces.tsx` and its tests). No gate entry and no route changes: all four roles already point at `ledger/expenses`.
- [ ] 1.2 Rewrite the file's doc comment. It must say which reader gets which shape and why the split is one of reach and never of financial truth (design D1), and keep the two existing reasons for what stays off this surface for everybody.
- [ ] 1.3 Compute `fullReach = holdsRole(session, 'super_admin') || managed`, once, at the top. `managed` comes from `useOutletScope`. Comment it as the transcription of `app_is_owner() OR outlet_id in app_outlets_for('franchise_admin')` that it is, so a later reader can check it against the policy rather than against memory.
- [ ] 1.4 Feed that one boolean to exactly two things: which day control renders, and `viewer.mayTouchAnyRow`. Nothing else branches on it.

## 2. The day control, for full reach only

- [ ] 2.1 Render `PeriodBar` + `DayField` from `src/components/ui/period-bar.tsx` when `fullReach`, with `testIdPrefix="expenses"`. One business date at a time, `showDates` off, `canStepForward={businessDate < today}`.
- [ ] 2.2 Lift `earliestOffered` out of `src/features/billing/manager-billing-history.tsx` into a shared home and call it from both. One year back to the first of that month, and its comment travels with it: a floor on the picker, not on the history (design D3).
- [ ] 2.3 Hold the bar's silhouette while the outlet's today resolves, the way billing history does, so the list below does not move when it lands.
- [ ] 2.4 Staff path unchanged: two business dates, no bar, `showDates` on, writes against today. Do not touch `DAYS_SHOWN`.

## 3. Record against the day on screen

- [ ] 3.1 Pass the shown business date to `ExpenseList` as `businessDate` under full reach, and today under the staff shape. `currentBusinessDate` stays the outlet's today for both — it is what `mayChange` reads for the staff clamp and it is not the same question.
- [ ] 3.2 Empty copy by day: today keeps the existing sentence; any other day reads "Nothing was recorded for this day." A statement, because the reader stepped there to find out (design D4).
- [ ] 3.3 Confirm the Add button still renders above an empty list on a past day. It should need no change — `ExpenseList` always renders its header row — but the case the whole change exists for is the day with nothing on it, so verify rather than assume.

## 4. What the day cost

- [ ] 4.1 A totals card under the list, full reach only: spent this day, of which cash. Summed on the client from the rows already on screen; withdrawn rows (`voidedAt !== null`) count toward neither (design D5).
- [ ] 4.2 Not on the staff shape. Two days on one list have no single day for a "this day" total to be about.

## 5. Pin it

- [ ] 5.1 A manager steps back and corrects: mount with a Franchise Admin session at a managed outlet, step the bar back one day, assert the day's rows list and a row recorded by somebody else offers Edit. **Prove it fails on the tree first** — there is no bar to step, so it fails before it can assert.
- [ ] 5.2 A Biller gets neither: no day bar rendered, two business dates requested, no action on a row recorded by somebody else. This is the regression guard for design D1 and must fail if the two shapes are ever collapsed into one.
- [ ] 5.3 Adding on a stepped-to past day passes that day's business date to `createExpense`, not today's. Read the argument, so the test says which day the surface meant rather than which one the database accepted.
- [ ] 5.4 The forward step and the calendar both stop at the outlet's today.

## 6. Documentation and the roadmap

- [ ] 6.1 `openspec/specs/manual-ledger/spec.md`: sync the added requirement from this change's delta.
- [ ] 6.2 Check whether `retire-the-manual-ledger` (#12) needs its surface inventory updated — it re-homes this file and its route, and this change renames both.
- [ ] 6.3 No ROADMAP.md row, number or wave. This closes walked-past clauses in `outlet-expenses` and `manual-ledger`; it is not new product.

## 7. Gate

- [ ] 7.1 `npm run typecheck`, `npm run lint`, the touched test files, `npm run format:check`.
- [ ] 7.2 Verify in the browser at both shapes: a manager stepping back a week and correcting a row, and a Biller seeing two days and no bar.
- [ ] 7.3 **Gate:** the owner and a manager reach any past business date through the same day bar Bills and the Ledger carry, and correct, withdraw and add an expense on the day they reached — while a Biller and an Employee keep the two-day window and the own-rows-today clamp.
