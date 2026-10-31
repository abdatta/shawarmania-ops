## 1. Fix

- [x] 1.1 A test in `e2e/fixed-costs.spec.ts`: every point of every row reaches its link or a control, and a tap on Shop rent's paid line opens its page (fails today on all six demo rows)
- [x] 1.2 `fixed-costs-surface.tsx`: the *This month* cell lets taps through to the row's link
- [x] 1.3 `data-table.tsx`: the stretched-link note says a positioned element in a later cell needs `pointer-events-none`

## 2. Gate

- [x] 2.1 The new test fails with 1.2 reverted and passes with it, on the desktop and tablet projects
  _(31 October: reverted, it lists all six demo rows as dead; restored, both projects pass.
  At the mobile preset in the built-in browser, a tap on Shop rent's paid text did nothing
  before and opens its page after.)_
- [ ] 2.2 Quick gates pass, pushed to `stage`, Staging green, and the staging build carries the commit
- [ ] 2.3 After the owner's Promote, a tap on a row's paid line opens it on the owner's phone
