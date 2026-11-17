# Design: zomato-upload-reads-carried-balances

## D1. The adjusted amount, and a refusal when anything is outstanding

The row carries Total, Adjusted and Outstanding. Adjusted is what this payout took. On the one measured row all three agree (1010.75, 1010.75, 0), and `Total Deductions` carries the same figure in its Total and Adjusted columns, so nothing yet distinguishes them.

A row with an amount outstanding would mean part of the balance moves on again, and which `Total Deductions` column the parser compares against (it reads Total) would then decide the reconciliation. That has never been seen, so it is refused by name rather than guessed, as this parser refused all of section D until now.

*Rejected:* reading Total. On a partial row it would subtract money this payout did not take.

## D2. The status cell does not decide

Every other line proves itself paid by a `settled` status cell. Section D's status cell reads `NA`: a carried balance is not an invoice Zomato settles, it is netted. Its proof is nothing outstanding (D1). Requiring `settled` would refuse every carried balance as "not settled yet", the refusal this change removes under another name.

## D3. One key with the sync

`source_ref` is `zomato-workbook:previous:<period start>:<type>:<cycle start>`, built exactly as the sync builds it (`shawarmania-sync` `src/sources/zomato/workbook.mjs`, with the cycle start appended in `buildCycles`). The upsert key on `aggregator_cycle_deductions` is `(outlet, source_system, source_ref)`, so a week read by both paths keeps one row. The upload already leaves a week the sync has settled alone (the parent change's D5); the shared key covers the other order, an upload first.

*Rejected:* the `row<n>` fallback the other sections use when the reference cell is `NA`. It is stable only within one layout and would never match the sync.
