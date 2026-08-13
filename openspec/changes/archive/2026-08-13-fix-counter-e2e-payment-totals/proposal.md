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

- `counter-billing`: Shift activity exposes the current tablet's bills but no
  aggregate payment totals; totals belong to the manager billing view.
- `counter-device-sessions`: Tablets show device and active-shift status without
  billing or drawer aggregates.

## Non-goals

- Change any billing, payment, counter, or manager user interface behaviour.
- Move or recalculate payment totals.
- Alter the deployment workflow or its test matrix.

## Impact

Affected code: `e2e/counter.spec.ts` and the corresponding living OpenSpec
requirements. No application API, schema, gate, adapter, or durable docs page
changes: `docs/SCREENS.md` already describes the manager-only totals view.
