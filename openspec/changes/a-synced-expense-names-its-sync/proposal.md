# Proposal: a-synced-expense-names-its-sync

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · corrects `outlet-expenses` · **Gate**: none — display copy away from the counter's run time, and a revert cleanly undoes it; `outlet-expenses-surface.test.tsx` passes, and its new test fails with the fix reverted.

## Why

An expense a sync writes (a Hyperpure order, a Zomato deduction) has no recorder: no person entered it, so `recorded_by` is null by design. The expanded row's **Recorded** line falls back to the word "someone" for a missing name, so every synced bill reads *"someone, 18 Oct, 2:14 pm"*. The owner read that as an unknown person writing into the books. The row already carries `source.system`, which says exactly who wrote it.

## What Changes

- **Recorded line**: a row with no recorder and a `source` reads *"<System> sync"*, the system's id in sentence case (`hyperpure` → *Hyperpure sync*, `zomato` → *Zomato sync*). The label is derived from the id, not looked up, so a sync added later is named with no change here.
- A row a person recorded reads as before. "someone" stays only where a person's name genuinely cannot be resolved.

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It rewords one line on an expanded expense row and writes nothing.

## Non-goals

- No change to what any sync writes, and no migration. Attributing synced rows in the database would put a fake account in `recorded_by`.
- *Last corrected* and *Withdrawn* are untouched: a sync's re-run updates in place without stamping a corrector, and only a person withdraws a row.
- No spec delta: `outlet-expenses` requires the record to keep its recorder and source, not how a missing recorder is worded.
