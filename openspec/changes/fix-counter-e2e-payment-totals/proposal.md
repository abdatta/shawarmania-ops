## Why

The latest deployment removes payment totals from the shared counter surface,
but its counter browser test still requires the removed elements. That stale
assertion blocks the production gate despite the intended UI contract being
implemented and covered at component level.

## What Changes

- Update the counter browser regression test to assert that Cash and UPI totals
  are absent from the shared shift rail.
- Preserve the separate manager billing-history totals coverage introduced with
  the removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This restores existing test coverage for the intentionally removed
counter totals; no product requirement changes.

## Non-goals

- Change any billing, payment, counter, or manager user interface behaviour.
- Move or recalculate payment totals.
- Alter the deployment workflow or its test matrix.

## Impact

Affected code: `e2e/counter.spec.ts` and this change record. No application
API, schema, gate, adapter, or documentation contract changes. No durable docs
page requires an update before archive because the user-visible behaviour and
its documentation remain unchanged.
