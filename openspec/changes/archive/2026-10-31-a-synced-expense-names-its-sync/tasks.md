## 1. Fix

- [x] 1.1 A test in `outlet-expenses-surface.test.tsx`: a Hyperpure row and a Zomato row with no recorder read *Hyperpure sync* and *Zomato sync* on the Recorded line (fails today with "someone")
- [x] 1.2 `expense-list.tsx`: the Recorded line names the source system when no person recorded the row

- [x] 1.3 The staging seed holds six Hyperpure orders and three Zomato deductions written as the syncs write them, outside the Cafe block and keyed by source reference, so the next push's `--if-empty` run adds them to the staging already there

## 2. Gate

- [x] 2.1 The new test fails with 1.2 reverted and passes with it; typecheck and format pass
  *(31 October: with `recorderOf` swapped back to `nameOf` the test *credits a row no
  person recorded to the sync that wrote it* fails; restored, all 9 pass.)*
- [x] 2.2 Pushed to `stage`, Staging green, and a synced Hyperpure bill on staging reads *Hyperpure sync*
  *(Staging green on every run since, 41135615281 among them, and live since Deploy
  39554145061 on 21 October; read in production on 31 October instead: 29 October's Hyperpure bill
  reads *Hyperpure sync, 29 Oct 2026, 07:25 am* on the owner's Expenses.)*
