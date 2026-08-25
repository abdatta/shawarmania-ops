# Repair Hyperpure statement sync

## Why

The scheduled Hyperpure reader can download a valid supplier statement but the
shared statement parser asks the restaurant-mapping table for a column that does
not exist, so neither the reader nor the manual upload fallback can finish. The
new Swiggy Read now dispatch guard and its reconnect probe repeated that query,
which would refuse every configured Swiggy request before its workflow can start
or report its session health.
Separately, the reader sends supply-run health to the restaurant-settlement
endpoint, which correctly refuses the `hyperpure` channel even though the
dedicated health tables admit it.

## What changes

- Make the shared statement parser and Swiggy dispatch guard select enabled
  restaurant mappings through their actual `state` field.
- Let the reader's existing secret-scoped bridge record a Hyperpure run only for
  an allowlisted outlet and a known health outcome; keep Hyperpure out of the
  payout-cycle ingest boundary.
- Route the private reader's Hyperpure outcomes through that bridge and pin both
  sides with regression coverage.
- Make the restaurant-mapping schema contract living documentation and a typed
  shared Edge Function boundary, checked in CI against generated database types.

## Non-goals

- This does not alter supplier money, expense deduplication, outlet assignment,
  or the Zomato and Swiggy settlement contracts.
- This does not add a Hyperpure OTP flow or make its supply statement resemble a
  revenue payout cycle.
