# Proposal: served-spec-waits-for-the-other-till

> **Model**: Opus · **Kind**: test-only fix, not a roadmap change · **Gate**: `e2e-auth/billing-served.spec.ts` "two tills seat one table while one is offline" never clicks the second till's card while it is still sliding; with that slide made ten times slower, the old harness clicked a moving card nine times in one run and the new one clicked none in three; and the test passes run after run outside any special hour.

## Why

*Two tills seat one table while one is offline* was recorded as failing whenever
its run crossed 00:00 UTC (05:30 IST): on CI `Deploy` run 36793266834 on
2026-09-30, and locally on 2026-10-03. **It is not a midnight bug.** Captured
with full traces on 2026-10-07/08, the run that crossed midnight passed; one
starting at 00:00:24Z failed, and so did one at 00:19Z, out of about fourteen
clean runs. Moving both tills' browser clocks across midnight changed nothing,
and nothing in the client or the database acts at 00:00 UTC.

**The failure is a race in the test.** Till one cancels its order, and the test
cancels the spare's at once. The spare learns of till one's cancellation by
Realtime, whenever that arrives, and its remaining card then slides up into the
freed place (`useFlip`, 280 ms). In every captured run that update landed within
about 300 ms of the spare's click. Playwright retries a click on a moving
element, and its fourth attempt scrolls the target to the **top** of the window,
here 140 px of page. A card's menu opens upward from a fixed position, so it then
sits wholly above the screen; the click on *Cancel order* waits out the test. Of
the retry alignments only that one is fatal, which is why most runs passed.

What was read as "the online till's order never reached the server" was till
one's screen at the timeout: synced, its own order already cancelled, the
spare's order the only one left. The CI retries then failed on that order, still
open at table 4, because a timed-out attempt never reaches its cleanup.

## What Changes

- `railSettled(page)` in `e2e-auth/tills.ts` waits until no finite animation is
  running in a till's pipeline. `cancelCard` waits on it before pressing the
  card's menu.
- After till one cancels, the test waits for the spare to stop showing till
  one's order before it acts there. Settling only covers motion that has already
  started, so the wait for the other till's change comes first.

## Non-goals

- **The menu's placement is not changed here.** A card's menu opening above the
  screen when its trigger sits near the top of the window is real for a biller
  too, on a page scrolled down to the expenses. Fixing it is app code and goes
  through its own change.
- No cleanup of a timed-out attempt's leftovers. A failure here still poisons the
  CI retries of the same test; with the race gone there should be no failure to
  poison them.
- The archived `the-suite-gives-the-same-answer-all-day` tasks are left as
  written; this folder is where the correction is recorded.
