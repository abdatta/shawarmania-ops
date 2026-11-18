# Proposal: the-demo-dates-a-deactivation-by-the-business-day

> **Model**: Fable · **Kind**: bug fix in the demo's seeded data, not a roadmap change · corrects how `src/data-access/mock/accounts.ts` dates the two seeded deactivations · **Gate**: `outlet-attendance.test.tsx` and `mock/deactivate-then-leave.test.ts` pass with the clock pinned inside the midnight-to-cutover window and outside it, and the pinned midnight cases fail with the fix reverted.

## Why

*keeps a deactivated person on the day — access cut is not departure* passed at 12:12 IST on 18 November and failed at 00:55 IST that night, alone and in the full suite, on an untouched `main`. It fails for exactly the hours from midnight to the 04:00 cutover.

The demo has one today, Kalyani's business day, and every seed counts days back from it. The attendance, store and customer mocks all resolve it through the cutover. The accounts mock alone counted its two seeded deactivations from the Kolkata calendar day. From midnight to the cutover those are different days, so:

- the Prep Cook's "lunchtime today" landed on a calendar day the roll-call had not reached, was clamped to now, and the roll-call, which draws the *deactivated* note from the calendar day of that moment, showed them without the note;
- the Deactivated Biller's last day slid one day later than the three days they are seeded as having worked before it.

This is the demo telling a different story for four hours every night, not only a test that could not be trusted after midnight. `docs/DEMO_MODE.md` already says business dates are relative to today through the outlet's own cutover; the fixture's own comment says the days count "as the attendance seeds" do. The code did not.

## What Changes

- `createDemoAccounts` dates a `DEACTIVATED_AT` seed by `seededDeactivation`: that time on the business day `daysAgo` back from Kalyani's business day, still never later than now.
- `mock/deactivate-then-leave.test.ts`: the existing case asserted the calendar anchor, which is why it could not catch this. It now pins the clock at three instants, one of them 00:55 IST, and asserts the business-day anchor.
- `outlet-attendance.test.tsx`: the roll-call's note for the deactivated Prep Cook is asserted with the clock pinned at 00:55, 12:12 and 23:30 IST, beside the original case, which still runs at whatever hour the suite does.
- `docs/DEMO_MODE.md`: one sentence, that every `daysAgo` seed counts from the same today.

## Change gate

No gate: demo data and tests only. Nothing a signed-in person at the counter, the kitchen or the owner's pages reads has changed, and a revert cleanly undoes it.

## The lane

Asked for as a `/quickfix`. That lane refuses itself for the demo seam, and this corrects a mock adapter's seeded data, so it carries the heavier gate rather than arguing the lane down: more than typecheck and the touched files was run (tasks 3.2 to 3.5), and the browser suites are owed before the Promote (task 3.6). The change folder is kept to a proposal and tasks because nothing here chooses between designs a later reader would have to reconstruct, and no requirement changes.

## Non-goals

- **No spec delta.** No requirement changes. `attendance-and-location` already lists a person deactivated after the deadline as *noted as deactivated* on that day, and the demo's Prep Cook is that case at every hour once the seed is dated correctly.
- **The roll-call's own note is left as it is, and it has a real gap this fix does not close.** The note is drawn where `businessDate >= deactivationDay(deactivatedAt)`, and `deactivationDay` is the Kolkata *calendar* day (design D10 of `a-deactivated-person-leaves-in-two-steps`, chosen for Team's label and for Remove). A manager who deactivates somebody between midnight and the cutover, during late service, therefore sees that person on that business day's roll-call with no *deactivated* note, that night and whenever the day is opened again; listing itself is right, because `wasActiveOn` compares instants. Proved with a scratch test on 18 November: deactivated at 15:30, noted; at 00:55 the same business day, listed and not noted. Changing it is a change to what a real manager sees and wants the owner's word and a scenario of its own (*deactivated in the night, noted on the day before*); the natural rule is the business day of the moment by the row's own outlet's cutover.
- **The mock's four copies of "the demo's today" are not folded into one helper.** `store.ts`, `customers.ts` and `attendance.ts` each resolve it correctly and separately; `accounts.ts` now does too. One shared helper would stop the next mock getting it wrong and is its own small change.
- **`today()` in the accounts mock still takes assignment dates from the UTC date.** From midnight to 05:30 IST that is the day before the Kolkata day the database's `app_kolkata_today()` would write, so an assignment started or ended in the demo in those hours is dated a day early. No test fails on it at 00:55, 03:45 or 04:30 IST (task 3.2); it is noted, not changed.
