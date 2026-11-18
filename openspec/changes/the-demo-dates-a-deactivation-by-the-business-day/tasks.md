# Tasks: the-demo-dates-a-deactivation-by-the-business-day

## 1. Reproduce and find the cause

- [x] 1.1 Reproduce on the real clock: at 01:09 IST on 19 November the case fails at its `/deactivated/` assertion, the Prep Cook's row present and the note missing.
- [x] 1.2 Find the cause: `createDemoAccounts` counts `DEACTIVATED_AT` from the Kolkata calendar day while the attendance mock counts from Kalyani's business day; from midnight to the cutover the seeded "12:30 today" is a day ahead, is clamped to now, and its calendar day is past the business day the roll-call opens on.
- [x] 1.3 Decide where the fault is: the seed. The roll-call's note has a real gap of its own for a deactivation made in the night, proved with a scratch test and left alone (proposal, Non-goals).

## 2. Fix and pin

- [x] 2.1 `mock/accounts.ts`: `seededDeactivation` dates a seed on the business day `daysAgo` back from Kalyani's, never later than now; `fixtures/accounts.ts` says business days.
- [x] 2.2 `mock/deactivate-then-leave.test.ts`: the case that asserted the calendar anchor now pins the clock at 15:30, 00:55 and 09:00 IST and asserts the business-day anchor for both seeded people.
- [x] 2.3 `outlet-attendance.test.tsx`: the Prep Cook's note asserted with the clock pinned at 00:55, 12:12 and 23:30 IST.
- [x] 2.4 Prove it: with `mock/accounts.ts` reverted, the two 00:55 cases fail (the Biller a day late; the note missing) and every other pinned case passes; restored, all pass.
- [x] 2.5 `docs/DEMO_MODE.md`: every days-back seed counts from the demo's one today.

## 3. Gate

- [x] 3.1 `npm run typecheck`, and both touched test files in full, on a real clock inside the window (01:13 IST).
- [x] 3.2 Neighbouring tests swept across the clock with a scratch setup file that shifts `Date` (not committed): `src/features/attendance`, `accounts` and `counter`, `src/data-access/mock`, the shift bill list, the outlet attendance section and the Supabase attendance adapter, 41 files and 507 tests, at 00:55, 03:45, 04:30, 05:45, 12:00 and 23:45 IST. All pass at every instant. The sweep sees the fault: with the fix reverted the original case fails at 00:55 and passes at 12:00. 04:30 is the hour the UTC date and the business date are a day apart.
- [x] 3.3 The machine's time zone, by reading rather than running (the owner's call, 18 November): the fix and its tests take no local or UTC date. The day comes from `resolveBusinessDate` (Asia/Kolkata by name), instants are written with `+05:30`, and the pinned instants are absolute, so Los Angeles, UTC on CI and India read the same.
- [x] 3.4 `npm run format:check` and `npm run lint` (no errors); `npm run build`; the built demo opened at 01:46 IST, inside the window: the Prep Cook reads *Prep · deactivated* today, and the Biller is present on 7 November, listed absent and deactivated on the 8th, and gone from the 9th.
- [x] 3.5 `npm test` twice on the real clock inside the window (01:20 and 01:50 IST): 3,362 and then 3,363 of 3,364 pass, every attendance, accounts and demo-mock test among them. `running-sync-check.test.tsx` failed both times and `menu-surface.test.tsx` timed out once; both pass alone. The first measures 2.4 s of real time against a three-second timer and the second ran out its 20 s under load, so neither reads a date or this change. Not investigated further.
- [ ] 3.6 Before the Promote, because this touches the demo's mock: the browser suites, which the push to `stage` runs. Not run locally. The database gates prove nothing here, since no migration, policy or function changes.
- [ ] 3.7 Pushed to `stage` when the owner asks, Staging green, and the staging build carries the commit.
