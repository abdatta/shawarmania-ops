## 1. Take the manual ledger's dates from the store

- [x] 1.1 Move `dayInput` inside the `over()` factory so it closes over `store.today`, and give the expenses describe an equivalent builder bound to a store. A builder that cannot be called without a store cannot default to a date somebody typed. Both builders now live in `over()`; the expenses block's `newExpense` object literal became `expenseInput(overrides)`, which also removed four `{ ...newExpense, x }` spreads.
- [x] 1.2 Replace every remaining `'2026-08-04'` with `store.today`, destructuring `store` where the test did not already. Fifteen literals gone. `'2020-01-01'` and `'2020-01'` stay, now with a line each saying they mean a date nobody ever wrote in, which no clock changes.
- [x] 1.3 Check the owner-only boundary case asserts against the same date the refused write used, rather than a literal that happens to match it. It now holds the refused input and reads `refusedDay.businessDate` back off it, so the assertion cannot drift from the write again.

## 2. Probe the attendance day from a direction that stays in the past

- [x] 2.1 Move the wrong-business-day probe to `shiftBusinessDate(businessDate, -1)`. The attendance day found is yesterday's, so the day after it is today and only in the past after 10:30 — the day before is in the past at every hour.
- [x] 2.2 Say in the test why the direction matters, so the next person does not flip it back for symmetry.

## 3. Judge the rest of the suite, and prove the repair

- [x] 3.1 Read every `2026-0` date literal under `src/` — 216 across 26 files — and record which are clock-coupled. **Only these two files were.** The rest divide cleanly: inputs to pure functions that take `now` as an argument (`attendance-record.test.ts` passes it explicitly in all 80, `datetime.test.ts`, `ledger.test.ts`, `billing.test.ts`); fixture facts under `mock/fixtures/`, which are seed data rather than assertions about today; three suites that already pin their own clock (`my-attendance`, `outlet-attendance`, `billing-counter`); assignment `startedOn`/`endedOn` dates that are all in the past and recede further every day (`session`, `phone-shell`, `nav-badge`, `use-real-session`, `accounts-surface`); and geolocation reading timestamps that nothing compares against now (`geolocation`, `check-in-card`, `outlets-surface` — and `check-in-card` already derives its business date through `resolveBusinessDate(new Date(), …)`, which is the pattern this change generalises).
- [x] 3.2 Prove the failure precedes the fix: the seven cases fail on today's real clock, captured before any edit. Six in `manual-ledger.test.ts`, where the literal had become a seeded day, so a list expected to hold one expense held three and an upsert expected to insert corrected in place instead; one in `attendance.test.ts`, answering `time_future` where the test asserted `time_wrong_day`.
- [x] 3.3 Run both files against shifted clocks: next day, next month, next year, New Year's Eve at 23:59, 00:10 on 1 March, and 04:35 — thirty-five minutes past the outlet cutover, where the business date and the UTC date disagree. 27 passed at every one. Then mutate the adapter's wrong-day branch to `if (false)` and confirm the repaired attendance probe fails, so it is green for the rule it names rather than for the future-time rule standing in front of it.

## 4. Record the rule

- [x] 4.1 `docs/TESTING.md`: a test that reads the demo store reads its dates from the store, beside the existing rule about giving a dated row one clock — including that a date needed in the past is derived backwards from the day under test, and that `vi.setSystemTime` is for a test whose subject is a particular moment, not a way to stop a suite rotting.

## 5. PHASE GATE

- [x] 5.1 **Gate**: `npm test` is green on any wall-clock date and at any time of day. Ran `npm run typecheck` (clean), `npm run lint` (0 errors, 2 pre-existing warnings), `npx prettier --check` on every changed file (clean), the two repaired files under six shifted clocks, and the full unit suite: **929 passed, 73 files, 0 failed**. `npm run format:check` reports `.claude/launch.json`, which this change does not touch: its working-tree copy has CRLF while the index and a Linux checkout have LF, so it is a local artifact and not a CI red. CI runs the rest.
