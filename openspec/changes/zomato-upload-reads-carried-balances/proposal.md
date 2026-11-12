# Proposal: zomato-upload-reads-carried-balances

> **Model**: Opus · **Kind**: correction to shipped behaviour (no roadmap row) · corrects `zomato-upload-settles-like-the-sync` (D6) · **Gate**: none — the owner's statement upload, away from the counter, no migration, and a revert cleanly undoes it; the new parser tests fail with the fix reverted.

> **Companion in the private sync repo.** `abdatta/shawarmania-sync` main `64d627a` (2026-11-12) taught the scheduled read the same rows, under the same `source_ref`. This change brings the manual upload to the same reading.

## Why

A Zomato week that nets negative is never paid and never listed. Zomato holds the balance and takes it from the next week that earns, where it appears only in section D of the workbook's `Addition Deductions Details` sheet, "Adjustments from previous weeks". The upload refuses any section D row by name, because when it was written no workbook had carried one and the row's sign in the payout was unproved.

It is proved now. Kalyani's (res 21917311) 26 Oct – 01 Nov 2026 workbook lists `Carry Forward payout from previous week | NA | NA | 07 October 26 - 07 October 26 | NA | 1010.75 | 1010.75 | 0` under D, counts it inside `Total Deductions (A) + (B) + (C)` (1010.75), and pays the six orders' ₹1,174.62 less ₹1,010.75: ₹163.87. The balance was 13 orders rejected on 28 Sep and 01 Oct, each carrying a rejection penalty, in a week with no sales. The sync, taught the same rows, reconciled that week live.

The spec already says an accepted workbook's adjustment lines "SHALL each be represented"; the refusal fell short of it.

## What Changes

- `parseZomatoAdjustments` reads a section D row as a `cycle_deductions` entry: `other_adjustment`, the **Adjusted amount** negated, dated to the period the row names, `source_ref` `zomato-workbook:previous:<period start>:<type>:<cycle start>`, the sync's exact key, so an upload and a sync read of the same week write one row, not two.
- A section D row is exempt from the "every deduction line settled" check, because Zomato writes `NA` in its status cell; the line proves itself taken by its Outstanding amount being nil instead.
- A row with an amount still outstanding is refused by name: the part a later payout takes has never been seen, and how `Total Deductions` counts it is unproved.
- Fixture and tests in `src/data-access/statements/statement-parser.test.ts` built from the measured rows; the old refusal test is replaced.

## Change gate

No gate: the owner's statement upload is away from the counter, the change writes through the existing write contract with an existing kind, and a revert cleanly undoes it.

## Non-goals

- No migration: `other_adjustment` is already a permitted kind, and `aggregator_cycle_deductions` already stores it.
- The rejection penalty is not booked as an expense. It belongs to no trading day, as the spec's cycle-deduction rule says; the owner may add an expense by hand.
- Partial carry-forwards (an amount outstanding) stay refused until one is measured.
- Additions and section C are unchanged.
