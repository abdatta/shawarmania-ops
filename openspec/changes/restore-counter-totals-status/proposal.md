# Proposal: restore-counter-totals-status

> **Model**: Terra · **Gate**: a biller sees this shift's Cash and UPI totals in the counter rail; a manager sees selected outlet-day totals before sync activity in one Status tab; the rail's duplicate heading is gone.

## Why

Cash and UPI totals were removed from the biller's counter even though they are
needed during a live shift. Separating the manager's status and totals also
turns one routine check into two destinations.

## Scope

- Restore current-shift Cash and UPI totals to the counter rail.
- Share the same payment-total cards with the manager's outlet-day Status view.
- Merge Sync status and Totals into Status, with totals first.
- Remove the rail heading that duplicates its own Open orders and Bills this
  shift headings.

## Non-goals

- No billing data, adapter, payment, offline, or tenancy change.
