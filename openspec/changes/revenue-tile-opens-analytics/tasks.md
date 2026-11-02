## 1. Fix

- [x] 1.1 `outlets-overview.test.tsx`: the month revenue link is Sales on Month (`from` the 1st, `to` today, `grain=day`, `align=month`, `metric=revenue`), P&L the Ledger's month (fails today with the Ledger address)
- [x] 1.2 `outlets-overview.tsx`: the month revenue tile links to Sales on Month; P&L keeps the Ledger
- [x] 1.3 Spec delta for `outlets-overview`: revenue links to Sales on Month

## 2. Gate

- [x] 2.1 The Overview test fails with 1.2 reverted and passes with it; build (typecheck), format and the touched test file pass; in the demo, tapping November revenue opens Sales with Month pressed and the same ₹ figure
- [ ] 2.2 Pushed to `stage`, Staging green, and staging Overview's month revenue opens Sales on Month
