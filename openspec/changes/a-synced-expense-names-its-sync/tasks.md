## 1. Fix

- [x] 1.1 A test in `outlet-expenses-surface.test.tsx`: a Hyperpure row and a Zomato row with no recorder read *Hyperpure sync* and *Zomato sync* on the Recorded line (fails today with "someone")
- [x] 1.2 `expense-list.tsx`: the Recorded line names the source system when no person recorded the row

- [x] 1.3 The staging seed holds six Hyperpure orders and three Zomato deductions written as the syncs write them, outside the Cafe block and keyed by source reference, so the next push's `--if-empty` run adds them to the staging already there

## 2. Gate

- [ ] 2.1 The new test fails with 1.2 reverted and passes with it; typecheck and format pass
- [ ] 2.2 Pushed to `stage`, Staging green, and a synced Hyperpure bill on staging reads *Hyperpure sync*
