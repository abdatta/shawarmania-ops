# Proposal: the-health-line-says-whether-reads-work

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · **Gate**: none — the owner's Delivery page, away from the counter, writes nothing, and a revert cleanly undoes it; the new `overdue.test.ts` case fails with the fix reverted.

## Why

On 12 November Swiggy was signed back in and its first read worked, but one week (18 – 24 Oct) did not reconcile against the payout Swiggy stated. The channel's health line read **Stuck**, in the fault colour, beside a channel that was reading fine; Zomato had shown the same that morning. The owner's ruling: that line answers whether the daily reads are working, and the week that would not add up already asks on its own row in *Needs you*, with the badge. A `reconciliation_failed` run read the portal and wrote its weeks, so the reads are working.

## What Changes

- `channelHealthWord` treats a `reconciliation_failed` run as working: **All quiet**, or **Overdue** once reads stop, exactly as an `ok` run. Lapsed and changed-shape runs keep **Stuck**.
- "The read worked" is named once, `READING_WORKED` / `readingWorked()` in `src/domain/delivery-attention.ts`, and used by both this line and the lapse healing from `a-read-that-worked-ends-a-lapse`, so the two cannot disagree.
- `docs/SCREENS.md` says what the line answers.

## Change gate

No gate: an owner page away from the counter that writes nothing, and a revert cleanly undoes it.

## Non-goals

- The *Read now* lockout is unchanged: it still applies only after an `ok` run, so the owner can read again after a mismatch.
- The disputed week, its row, its actions and the badge are unchanged.
- Hyperpure's line has no reconciliation outcome and is unchanged.
