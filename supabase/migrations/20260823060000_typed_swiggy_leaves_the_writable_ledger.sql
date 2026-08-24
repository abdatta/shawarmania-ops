-- Swiggy's typed money leaves the writable ledger.
--
-- Task 10.1 of swiggy-settlement-sync, gated on tasks 9.3-9.5 passing and the
-- owner accepting the coverage audit (accepted 2026-08-24: extracted data
-- overrides typed data wherever they disagree, because typed entry is
-- error-prone).
--
-- Every typed fact was carried losslessly into legacy_typed provenance by
-- 20260823030000 and verified against the backup to the paisa; where measured
-- settlements exist they already supersede it in place. Nothing reads these
-- columns in database code, so removal is a pure column drop: the commission
-- check constraint goes with its columns, PostgREST refuses stale payloads
-- naming the dropped keys with PGRST204 rather than discarding them quietly,
-- and the generated types stop admitting them at compile time.

alter table public.manual_ledger_days
  drop constraint manual_ledger_days_swiggy_commission_within_revenue;

alter table public.manual_ledger_days
  drop column swiggy_revenue_paise,
  drop column swiggy_commission_paise;
