## 1. Fix

- [x] 1.1 A test in `aggregator-sync.test.ts`: a lapse followed by a `reconciliation_failed` run is resolved; one followed by `awaiting_one_time_password` is not (the first fails today)
- [x] 1.2 `aggregator-sync.ts`: the recovery query asks for `READING_WORKED` (`ok`, `reconciliation_failed`) instead of `ok` alone

## 2. Gate

- [x] 2.1 The new test fails without 1.2 and passes with it
- [x] 2.2 Quick gates pass, pushed to `stage`, Staging green, and the staging build carries the commit
  _(Staging run 43184358794 green on `f632cc42`, which carries `a3687cc3`; live in production with Deploy 43190699464 on 12 November.)_
- [x] 2.3 After the owner's Promote, the Zomato tab shows no Reconnect card while the 26 Oct – 1 Nov week still asks
  _(Waived by the owner, 16 November: the week reconciled on the owner's 13:49 IST read of 12 November, before the Deploy, so the case can no longer be shown. Every Zomato read since has been `ok`, read in production on 15 November.)_
