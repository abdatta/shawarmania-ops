# Customer Loyalty And Cross-Outlet Insights

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Customers

## Expectation

The business can recognise repeat activity by the same global customer across
outlets and, if it chooses to introduce loyalty, apply one understandable
benefit without allowing an outlet role to inspect another outlet's customer
history.

## Baseline after the billing roadmap

`global-customer-identity` (#32) deliberately solves identity only:

- one canonical full phone identifies one minimal business-wide customer;
- an eligible billing context may retrieve that profile only by exact phone;
- orders, bills, visits, spend, and histories remain outlet-scoped;
- the global customer row carries no visit or spend aggregates;
- knowing a customer ID grants no access to another outlet's transactions.

That is enough to reuse billing details safely. It is not a loyalty programme
and does not provide cross-outlet activity or spend insights. Those are explicit
non-goals of #32 and remain the work represented by this todo.

## Why it is deferred

The owner asked for reusable customer details at Billing V1 launch, not rewards,
marketing, or cross-outlet analytics. Adding activity aggregates creates a new
privacy and franchise-governance surface, while the launch benefit is currently
hypothetical.

Keeping this separate also protects the isolation rule: a future owner-level
aggregate or loyalty decision must not become an outlet-readable transaction
history merely because both are keyed by the same global customer.

## What already exists for it

- #32 provides the non-enumerable global identity and keeps transaction RLS intact.
- #33 links immutable outlet-owned orders and bills to customer identity without
  putting spend totals on the global profile.
- The owner-level reporting boundary where a business-wide insight could
  eventually live was to be #13's. That change was withdrawn on 2026-08-31 and
  its surfaces deleted, so this note would have to establish that boundary
  itself.

## Open questions

- What business action needs this: a visit count, spend bands, a points balance,
  or a concrete reward? These have different correction and expiry rules.
- Who may see business-wide activity? An SA-only aggregate is much safer than
  exposing another franchise outlet's customer relationship to an FA or Biller.
- Does loyalty require transaction detail, or can narrowly computed aggregates
  answer the need without crossing the history boundary?
- What consent and franchise-agreement language is required before activity from
  separate outlets contributes to one brand-wide programme?
- How are mistyped, reassigned, or shared phone numbers corrected without moving
  immutable historical bills silently between people?

## Trigger to promote

A real loyalty offer or repeat-customer decision whose value requires activity
across outlets, with the audience and privacy boundary decided first.

**Dependencies when seeded**: `global-customer-identity` (#32) and
`billing-live` (#10). It also named `owner-console-live` (#13) for owner-only
insights; that change was withdrawn on 2026-08-31. Interacts
with [`data-retention-policy`](./data-retention-policy.md) and
[`bill-digital-share`](./bill-digital-share.md).
