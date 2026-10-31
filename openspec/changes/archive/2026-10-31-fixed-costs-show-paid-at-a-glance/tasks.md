## 1. Build

- [x] 1.1 A test in `fixed-costs.test.tsx`: an unpaid cost draws an empty ring, a part-paid one a partly filled ring, a fully paid one the Present tick, and an overdue row counts the overdue in the whole (fails today: no ring)
- [x] 1.2 `fixed-costs-surface.tsx`: `MonthProgress` draws the ring in the gap left of the figure

## 2. Gate

- [x] 2.1 The new test fails without 1.2 and passes with it; typecheck, format and the touched test file pass
- [x] 2.2 Pushed to `stage`, Staging green, and the staging Fixed costs list shows the rings aligned under This month on a phone and a laptop
  *(Staging green on every run since `eecee1c5`; live since Deploy 41014535293 on
  30 October. Read in production on 31 October instead: the rings line up under
  This month on the owner's laptop and, in both the running and the Stopped
  lists, on the owner's phone.)*
