# Proposal: billing-history-two-controls

> **Model**: Opus 5 · **Kind**: production correction to a shipped surface, not a roadmap change · **Gate**: Billing history asks two questions instead of four — which outlet, which day — in the same controls the Ledger and Attendance already use; and Status adds the day's combined takings and its average bill to the Cash and UPI cards.

## Why

Billing history opens with four pickers, two of which are answered `All` and
almost never changed. `All statuses` and `All payments` narrow a list that is
already one outlet's one day, and a manager scanning that day wants to see the
cancelled bills, not to have to ask for them: the list already names each bill
Paid or Cancelled, so the filter was re-stating what the rows say.

Removing the two leaves the two that matter, and they are asked here in an idiom
this surface invented for itself: a dropdown of outlets and a lone date button,
where the Ledger and Attendance both use outlet chips in the page header and a
day bar with a step either side. Three surfaces answering "which outlet, which
day" three different ways is two things too many to learn.

The Status view's Cash and UPI cards already carry the day's takings split by
tender, and stop one question short of the two the owner actually asks of a
trading day: what did it take altogether, and what did an average bill come to.

## What Changes

- Drop the bill-status and payment-method pickers. Every bill for the outlet-day
  is listed, cancelled ones keeping the Cancelled badge they already carry.
- Replace the outlet dropdown with the shared outlet chips in the page header,
  and the lone date button with the Ledger's day bar, steps included. Both come
  from the controls those surfaces already use rather than from copies.
- Add `Total` and `Average bill` cards beside Cash and UPI, over paid bills only,
  in the same card presentation the counter and this surface already share.

## Non-goals

- No multi-outlet reading here. The chips are single-select, as on the Ledger;
  reading several outlets at once needs the three reads on this surface to fan
  out and every row to name its outlet, which is a change of its own.
- No adapter, query, tenancy or command change. `listManagerHistory` keeps its
  status and payment-method parameters, which the counter and its tests use;
  this surface stops passing anything but `all`.
- Nothing new about cancellation, sync status or open orders.
