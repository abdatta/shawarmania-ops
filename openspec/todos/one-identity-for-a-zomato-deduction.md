# One Identity For A Zomato Deduction

**Type**: Correctness · **Status**: Recorded 2026-09-30 by `zomato-upload-settles-like-the-sync` · **Area**: Aggregator settlement

## Expectation

A Zomato deduction (an ad, a service charge) reaches the expense ledger once,
whichever path settled its week — the sync or an uploaded payout workbook.

## Current behaviour

The sync (`abdatta/shawarmania-sync`) reads a cycle's deductions from the
dashboard's expenses tab and keys each on Zomato's `expense_id`. The payout
workbook's `Addition Deductions Details` sheet never shows that id; it carries the
invoice or campaign id instead, so the upload keys the same deduction as
`zomato-workbook:<type>:<invoice>`. The ingest deduplicates on
`(outlet, source_system, source_ref)`, so the two are different rows.

An upload for a week already settled writes nothing (design D5), which covers the
usual order: the sync settles, a person uploads later. The reverse order — a week
settled by upload while the sync was down, then re-read by the sync once it is
back — could book a non-Hyperpure deduction twice. Hyperpure bills, the only Zomato
deductions seen since go-live, are skipped by both paths because Hyperpure's own
reader owns them.

## The likely fix

Have the sync read the same `Addition Deductions Details` sheet from the workbook
it already downloads for every closed cycle, so both paths key a deduction the same
way. The four-cycle sweep for late supply bills would then need a workbook per
older cycle, a few more seconds per run.

## Trigger to promote

The first Zomato ad or non-Hyperpure deduction appears on a payout.
