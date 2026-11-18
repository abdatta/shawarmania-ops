# Proposal: the-demo-dates-a-deactivation-by-the-business-day

> **Model**: Fable · **Kind**: bug fix, not a roadmap change · corrects how `src/data-access/mock/accounts.ts` dates the two seeded deactivations, and the day the roll-call notes a deactivation from · **Gate**: `outlet-attendance.test.tsx` and `mock/deactivate-then-leave.test.ts` pass with the clock pinned inside the midnight-to-cutover window and outside it, and the pinned midnight cases fail with the seed fix reverted; the night case in `features/attendance/deactivate-then-leave.test.tsx` fails with the roll-call fix reverted.

## Why

*keeps a deactivated person on the day — access cut is not departure* passed at 12:12 IST on 18 November and failed at 00:55 IST that night, alone and in the full suite, on an untouched `main`. It fails for exactly the hours from midnight to the 04:00 cutover.

Two faults share one cause, a deactivation dated by the calendar where attendance reads business days.

**The demo's seed.** The demo has one today, Kalyani's business day, and every seed counts days back from it. The attendance, store and customer mocks all resolve it through the cutover. The accounts mock alone counted its two seeded deactivations from the Kolkata calendar day. From midnight to the cutover those are different days, so:

- the Prep Cook's "lunchtime today" landed on a calendar day the roll-call had not reached, was clamped to now, and the roll-call showed them without the *deactivated* note;
- the Deactivated Biller's last day slid one day later than the three days they are seeded as having worked before it.

`docs/DEMO_MODE.md` already says business dates are relative to today through the outlet's own cutover; the fixture's own comment says the days count "as the attendance seeds" do. The code did not.

**The roll-call's note.** With the seed corrected the test passes, and the live screen was still wrong in the same hours. The note was drawn where `businessDate >= deactivationDay(deactivatedAt)`, and `deactivationDay` is the Kolkata *calendar* day (design D10 of `a-deactivated-person-leaves-in-two-steps`, chosen for Team's label and for Remove). A manager who deactivated somebody between midnight and the cutover, during late service, saw that person on that business day's roll-call with no note, that night and whenever the day was opened again. Listing itself was right, because `wasActiveOn` compares instants. Proved with a scratch test on 18 November: deactivated at 15:30, noted; at 00:55 the same business day, listed and not noted. The owner asked for it fixed here the same day.

## What Changes

- `createDemoAccounts` dates a `DEACTIVATED_AT` seed by `seededDeactivation`: that time on the business day `daysAgo` back from Kalyani's business day, still never later than now.
- The By day roll-call notes a deactivation from `deactivationBusinessDay`: the business day of the moment by the cutover of the outlet the row belongs to. Team's *Deactivated · date* and the day Remove ends outlets on keep the calendar day, as D10 decided.
- `mock/deactivate-then-leave.test.ts`: the existing case asserted the calendar anchor, which is why it could not catch the seed. It now pins the clock at three instants, one of them 00:55 IST, and asserts the business-day anchor.
- `outlet-attendance.test.tsx`: the roll-call's note for the deactivated Prep Cook is asserted with the clock pinned at 00:55, 12:12 and 23:30 IST, beside the original case, which still runs at whatever hour the suite does.
- `features/attendance/deactivate-then-leave.test.tsx`: somebody switched off at 02:00 is noted on the business day before, and not listed the day after.
- `docs/DEMO_MODE.md`: every `daysAgo` seed counts from the same today. `docs/SCREENS.md`: a 02:00 switch-off is noted on the business day it belongs to.

## Capabilities

### Modified Capabilities

- `attendance-and-location`: one added requirement, that a deactivation is noted from the business day it happened on. The existing scenarios said who is listed in the night case and were silent on the note.

## Change gate

No gate. The seed is demo data. The note is a word on the manager's attendance page, away from the counter and the kitchen; it reads nothing new, writes nothing, and a revert cleanly undoes it. It can only add the note one business day earlier than before, never remove it, since a moment's business day is its calendar day or the day before.

## The lane

Asked for as a `/quickfix`. That lane refuses itself for the demo seam, and this corrects a mock adapter's seeded data, so it carries the heavier gate rather than arguing the lane down: more than typecheck and the touched files was run (tasks 3.2 to 3.5), and the browser suites are owed before the Promote (task 3.6). No `design.md`: the one choice, which day the note counts from, is recorded above with its reason.

## Non-goals

- **Team and Remove keep the calendar day.** *Deactivated · 13 Oct* for a 02:00 switch-off on the 13th is the date it happened; only attendance reads business days.
- **By staff is untouched.** Its month already stops at the business day of the moment.
- **The mock's four copies of "the demo's today" are not folded into one helper.** `store.ts`, `customers.ts` and `attendance.ts` each resolve it correctly and separately; `accounts.ts` now does too. One shared helper would stop the next mock getting it wrong and is its own small change.
- **`today()` in the accounts mock still takes assignment dates from the UTC date.** From midnight to 05:30 IST that is the day before the Kolkata day the database's `app_kolkata_today()` would write, so an assignment started or ended in the demo in those hours is dated a day early. No test fails on it at 00:55, 03:45 or 04:30 IST (task 3.2); it is noted, not changed.
