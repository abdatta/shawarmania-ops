# NEXT SESSION: make the pgTAP suite speak the post-freeze contract

CI run 32741120072 is RED on `gate / database + auth tests` because
`supabase/tests/*.sql` still characterize typed Swiggy columns that migration
`20260823060000_typed_swiggy_leaves_the_writable_ledger.sql` dropped.
Deploy is safely blocked; production is untouched. Local `npm test`,
typecheck, lint, format, build, e2e, e2e:auth, contrast are all green.

## The fix (mechanical, ~30 sites)

In `supabase/tests/21_manual_ledger.sql`:

1. Every day-row INSERT naming `swiggy_revenue_paise, swiggy_commission_paise`
   drops the pair AND its aligned value literals (lines 94-96, 108, 172,
   182, 224, 330, 462, 492, 550, 955, 1080).
2. Line 157 `col_is_null(... 'swiggy_commission_paise' ...)` → replace with a
   catalog assertion that NO attribute of manual_ledger_days matches
   `swiggy%` (copy the expenses-marker pattern used at line ~190).
3. Test at 178-185 ("accepted, because Swiggy is still typed") → INVERT:
   assert via catalog that the columns are gone; delete the insert block.
4. Lines 246-330 `has_column/col_is_null` style assertions listing swiggy
   commission among checked columns → drop those entries; where the test's
   PURPOSE was the freeze boundary, rewrite to assert absence (catalog) or
   that a settlement row supersedes (query aggregator_channel_days).
5. Comment lines 178, 295 updated to the new authority sentence.

Other files (single-digit sites each): `28_billing_live_from.sql` (6),
`32_zomato_settlement_sync.sql` (2), `33_aggregator_cycle_ingest.sql` (1),
`35_rehearse_aggregator_cycle.sql` (1), `36_supply_statement_ingest.sql` (1)
— same treatment: remove dropped-column references from selects/fixtures.

## Verification before push

`npm run db:start && npm run db:reset && npm run test:db && npm run test:rls`
and READ THE FULL TAIL of test:db output (the earlier local PASS was read off
a truncated grep - do not trust a single matched line).

Then rerun the failed CI job (`gh run rerun 32741120072 --failed`), confirm
Deploy goes green (migrate applies nothing new; deploy publishes the freeze),
tick nothing new (10.1/10.2 already ticked), and continue with 11.x.

## State snapshot for continuity

- Ops main = 436ce0f (freeze wave committed; CI red on pgTAP only).
- Prod: sync switched on from Jul 1; 21 settlement days live; legacy rows
  superseding correctly; Aug 17 awaits FINAL cycle.
- Tonight 23:15 IST + tomorrow 11:15 IST scheduled fires = task 10.4.
- Remaining ticks after pgTAP green: 10.4, 10.5, 11.1-11.7.
