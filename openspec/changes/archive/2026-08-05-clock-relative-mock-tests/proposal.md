# Proposal: Clock-Relative Mock Adapter Tests

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · **Gate**: **`npm test` is green on any wall-clock date and at any time of day**, proved by running the two repaired files against a system clock moved forward a day, a month and a year, and by the fact that they fail on today's real clock before the fix.

## Why

`npm test` is red on `main` with seven failures nobody caused. `createDemoStore`
resolves its "today" from the wall clock, and two mock-adapter test files wrote
today's date down instead of asking the store for it. The literal was correct on
the day it was typed and has been wrong every day since.

A suite that rots on a calendar is worse than a suite that fails: it teaches
whoever runs it that red is the normal state, and the next genuine failure
arrives in a file already expected to be red.

## What Changes

- The manual-ledger mock tests take every date from the store they are testing.
  The input builders are bound to a store rather than declared beside it, so a
  date cannot be written down by omission.
- The attendance mock test's wrong-business-day probe moves to the day *before*
  the attendance day. The day after it was yesterday's tomorrow, which is today,
  which is only in the past after 10:30 in the morning.
- One rule in `docs/TESTING.md`, next to the one about giving a dated row one
  clock, because this is the same mistake one layer up.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. No requirement changes. The mock adapters already behave as their specs
demand and are untouched here; what changed is that two test files stopped
describing them correctly as time passed.

## Impact

Two test files and one docs paragraph. No production code, no fixture, no
schema, no policy, no gate.

## Non-goals

- Pinning the clock with `vi.setSystemTime`. It is fewer edits and it hides
  exactly the date-boundary behaviour these adapters exist to get right — a
  frozen clock would have made the attendance probe pass while still asserting
  the wrong branch.
- Rewriting the date literals in the rest of the suite. They were judged one by
  one; the remainder are either inputs to pure functions, fixture facts, or
  clocks the test pins itself. Recorded in tasks 3.1.
- Making `createDemoStore` take an injectable clock. That is a wider change to
  demo-mode plumbing than a red suite justifies.

## Docs to update before archive

`docs/TESTING.md` only — the rule that a test reading the demo store reads its
dates from the store too.
