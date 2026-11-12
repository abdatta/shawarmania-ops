## 1. Fix

- [x] 1.1 A test in `aggregator-sync.test.ts`: a lapse followed by a `reconciliation_failed` run is resolved; one followed by `awaiting_one_time_password` is not (the first fails today)
- [x] 1.2 `aggregator-sync.ts`: the recovery query asks for `READING_WORKED` (`ok`, `reconciliation_failed`) instead of `ok` alone

## 2. Gate

- [x] 2.1 The new test fails without 1.2 and passes with it
- [ ] 2.2 Quick gates pass, pushed to `stage`, Staging green, and the staging build carries the commit
- [ ] 2.3 After the owner's Promote, the Zomato tab shows no Reconnect card while the 26 Oct – 1 Nov week still asks
