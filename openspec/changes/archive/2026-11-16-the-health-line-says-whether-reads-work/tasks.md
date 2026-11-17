# Tasks: the-health-line-says-whether-reads-work

## 1. Fix

- [x] 1.1 A case in `overdue.test.ts`: a `reconciliation_failed` run reads *All quiet*, and *Overdue* once stale (fails today with *Stuck*)
- [x] 1.2 `READING_WORKED` / `readingWorked()` in `src/domain/delivery-attention.ts`, used by `channelHealthWord` and by the adapter's lapse healing
- [x] 1.3 `docs/SCREENS.md`: the line answers whether the reads are working

## 2. Gate

- [x] 2.1 The new case fails without 1.2 and passes with it
  _(12 November: before 1.2 it failed reading *Stuck*; after, 659 related tests pass.)_
- [x] 2.2 Quick gates pass, pushed to `stage`, Staging green
  _(Staging run 43196616491 green on `960ce0f1`; live in production with Deploy 43198649102 on 12 November.)_
- [x] 2.3 After the owner's Promote, the Swiggy line reads *All quiet* while 18 – 24 Oct still asks under Needs you
  _(Waived by the owner, 16 November: the owner accepted 18 – 24 Oct at 15:55 IST on 12 November, minutes after the Deploy, so the week no longer asks. Every Swiggy read since has been `ok`, read in production on 15 November.)_
