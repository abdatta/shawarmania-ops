# Proposal: mock-unwind-test-stays-in-its-day

> **Model**: Opus · **Kind**: test-only fix, not a roadmap change · **Gate**: `src/data-access/mock/billing.test.ts` passes with its fake clock started at any hour, including 03:00–04:00 IST where it failed, and the pinned test fails without its pin at 03:15 IST with the reported refusal.

## Why

*Keeps an unprepared order's payment reversible however long ago it was taken*
failed on a clean checkout of `stage` at 21:45 UTC (03:15 IST) on 2026-10-13,
and had passed in Staging run 38457964697 at 19:55 UTC. A sweep of start
instants shows it failing for exactly the hour 03:00–04:00 IST and passing at
every other hour.

**The adapter is right; the test's premise is not.** The test pays an
unprepared order and then lets an hour pass on the payment clock. Its fake timers
start from the wall clock, so between 03:00 and 04:00 that hour crosses the
04:00 cutover. Past it, the demo projects the #69 day change: an order paid and
never ticked reads prepared at the cutover, the five-minute window starts there,
and by 04:15 it has expired. The live `unpay_billing_order` measures the same
window from the same `prepared_at` stamp, so the mock's refusal is the one the
database would give. Nothing in the demo seam changes.

## What Changes

- The test pins its clock to midday IST, so the hour it lets pass stays inside
  one business day, and its name says *that day*: what it proves is no longer
  claimed across a day change it cannot survive.
- `docs/TESTING.md` gains the rule: a test that lets demo time run for an hour
  or more is about a particular moment, and pins a start inside one business day.

## Change gate

No gate: test and docs only. Nothing in the app or the database changes, so there is no behaviour to turn off.

## Non-goals

- No change to the mock or live adapters, the day-change projection or the
  edit window. Both answer the same way at 04:15.
- No new test for the take-back past the cutover. The refusal at the cutover is
  the existing #69 behaviour; this fix only stops one test sampling it by accident.
- No file-wide clock pin. A sweep of the whole file across eleven start instants
  found this the only hour-dependent case, and `docs/TESTING.md` reserves pinning
  for tests whose subject is a moment.
