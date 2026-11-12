# Tasks: the-health-line-says-whether-reads-work

## 1. Fix

- [x] 1.1 A case in `overdue.test.ts`: a `reconciliation_failed` run reads *All quiet*, and *Overdue* once stale (fails today with *Stuck*)
- [x] 1.2 `READING_WORKED` / `readingWorked()` in `src/domain/delivery-attention.ts`, used by `channelHealthWord` and by the adapter's lapse healing
- [x] 1.3 `docs/SCREENS.md`: the line answers whether the reads are working

## 2. Gate

- [x] 2.1 The new case fails without 1.2 and passes with it
  _(12 November: before 1.2 it failed reading *Stuck*; after, 659 related tests pass.)_
- [ ] 2.2 Quick gates pass, pushed to `stage`, Staging green
- [ ] 2.3 After the owner's Promote, the Swiggy line reads *All quiet* while 18 – 24 Oct still asks under Needs you
