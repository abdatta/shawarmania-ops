## 1. Fix

- [x] 1.1 A test in `outlets-overview.test.tsx`: a ₹10,50,141 headline keeps the regular size where nothing overflows, and the drawer caption reads *Left ₹2.11K · Spent ₹23.1K* with cash *₹950* (fails today with `text-lg` and *₹2,114*)
- [x] 1.2 `compactPaise` in `src/domain/money.ts`: three significant digits, Indian units, promotion at a unit's limit; unit tests in `money.test.ts`
- [x] 1.3 `outlets-overview.tsx`: captions use `compactPaise`; the headline measures its cell and shrinks only on overflow; `ValueBeside` gains a last form with both figures small
- [x] 1.4 `analytics-chart.tsx`: the short form of `metricText` uses the same formatter

## 2. Gate

- [x] 2.1 The new Overview test fails with 1.3 reverted and passes with it; typecheck, format and the touched test files pass
- [ ] 2.2 Pushed to `stage`, Staging green, and staging Overview shows a full-size seven-digit headline on a wide screen and a smaller one at phone width
