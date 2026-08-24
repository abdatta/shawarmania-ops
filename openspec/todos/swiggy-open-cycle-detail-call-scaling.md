# Swiggy Detail Calls Must Stay Bounded As Open-Cycle Order Volume Grows

## Expected behaviour

The twice-daily Swiggy reader continues to publish the same GST-exclusive
daily stated value as the later payout annexure, without becoming slow or
rate-limited as an outlet's open payout cycle grows.

## Why this is not trivial

The proved daily basis comes from each order's Finance detail: `Total Customer
Paid - GST Collected`. The list response intentionally cannot replace that
detail because its customer-paid amount includes GST. Re-reading every open
order is the conservative correct behaviour today: an order can still change
status or payout composition before the cycle closes.

A busier outlet could make that one-detail-call-per-open-order strategy too
slow or too close to the operator's rate limits. Any optimisation must retain
the same business-date cutover, fail closed on a missing/changed detail shape,
and re-read every order whose value can still change. It must not fall back to
the GST-inclusive list field or a calendar-day aggregate.

## Trigger to promote

Promote this when the Swiggy reader approaches its workflow time budget,
receives throttling, or an open payout cycle has enough orders that repeated
full-detail reads are materially expensive. Measure the live request volume and
order-change behaviour first; then design a cursor/cache/revalidation policy
with a fixture and reconciliation proof against the final annexure.
