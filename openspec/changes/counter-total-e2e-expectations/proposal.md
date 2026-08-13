# Proposal: counter-total-e2e-expectations

> **Gate**: the browser suite accepts current-shift Cash/UPI totals and the
> combined manager Status tab, rather than timing out while looking for removed
> UI.

## Why

The counter payment-total quickfix changed the interface and unit tests, but
two browser assertions still expected the removed layout. Their retries delayed
the release and then blocked deployment.

## Scope

- Update the counter browser assertions for shift Cash/UPI totals.
- Update manager-history browser navigation from Totals and Sync status to
  Status.

## Non-goals

- No production behavior, data, policy, or adapter change.
