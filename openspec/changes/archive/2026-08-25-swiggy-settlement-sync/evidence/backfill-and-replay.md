# 9.5 backfill through the real ingest boundary (2026-08-24)

Three consecutive swiggy-daily workflow_dispatch runs (rehearse=false) posted
candidates built from live reads + annexure facts for RID 1096540 -> Kalyani:

1. Run 1 (32731298053): first full success after the supersession fix landed.
2. Run 2 (32733521050): completed coverage - 21 settlement days Jul26..Aug15,
   every legacy-covered date superseded in place (old values retained in
   superseded_revenue/commission_paise with superseded_at).
3. Run 3 (32734639981): idempotent replay - counts byte-stable at
   provisional=3, legacy_typed=24, settlement=21; no new churn.

Authority ladder verified on production:
- Aug 8 Kalyani now reads measured revenue 117200 / commission 36226 /
  net 80974 with typed 117200/43364 retained as superseded history.
- Aug 17 keeps its readable legacy value because its cycle is still PENDING -
  a provisional read correctly cannot reopen a settled day.
- Kanchrapara zero days untouched; no mapping, no runs.

Enablers shipped en route: outlet_channel_sync switch-on migration
(20260823040000), settlement-supersedes-legacy RPC fix (20260823050000),
SWIGGY_MAPPINGS repo variable, write mode in swiggy-daily.yml.
