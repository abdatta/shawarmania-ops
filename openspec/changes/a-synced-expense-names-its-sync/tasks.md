## 1. Fix

- [x] 1.1 A test in `outlet-expenses-surface.test.tsx`: a Hyperpure row and a Zomato row with no recorder read *Hyperpure sync* and *Zomato sync* on the Recorded line (fails today with "someone")
- [x] 1.2 `expense-list.tsx`: the Recorded line names the source system when no person recorded the row

## 2. Gate

- [ ] 2.1 The new test fails with 1.2 reverted and passes with it; typecheck and format pass
- [ ] 2.2 Pushed to `stage`, Staging green, and a synced Hyperpure bill on staging reads *Hyperpure sync*
