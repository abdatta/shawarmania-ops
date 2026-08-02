# Data Retention Policy

**Type**: Feature · **Status**: Anticipated — **trigger fires earlier than the roadmap frames it** · **Area**: Security

## Expectation

Personal data has a defined lifetime. Customer contact details and attendance location history are removed or anonymised on a stated schedule, and that schedule is documented well enough to answer an employee asking what is kept about them and for how long.

## Current behaviour

Nothing is deleted, ever. Customer names and phone numbers persist indefinitely. Attendance stores coordinates, accuracy and computed distance for **every check-in and every approval**, and those accumulate indefinitely too. Since #26 that includes the approving manager's own position, so the accumulating location history is about managers as well as staff.

## Why it is deferred

Until attendance shipped there was no personal data to retain, so there was nothing to write a policy about. It is not deferred on a judgment that retention does not matter.

## Why the trigger is nearer than it looks

The roadmap frames the trigger as *meaningful customer volume, or a franchise agreement specifying retention*. Those are real, but they are not the first one to fire.

**Employee location history starts accumulating the day attendance goes live in production**, and it is the most sensitive data the system holds — a per-person movement record, on staff who did not choose to be measured, kept by their employer. Customer phone numbers are a lower-stakes problem that will arrive later. Treating "customer volume" as the trigger would let the sharper exposure build up unexamined for however long that takes.

## What already exists for it

- **Location is captured at a check-in, an approval, and an outlet capture only.** There is no background tracking anywhere in this system, so the volume is bounded at roughly two points per person per day rather than a continuous trail — a deliberate design decision that also makes this policy much easier to write.
- Attendance rows carry a business date, so an age-based rule has a clean key.
- `global-customer-identity` (#32) **has landed**, and it minimised the global
  profile to canonical phone, optional name, and internal created/last-used
  timestamps — the cached visit and spend aggregates are dropped columns, not
  unused ones. So the surface a retention rule has to erase is now the smallest
  it can be, and there is exactly ONE row per person to erase rather than one per
  outlet they ever visited. That is a simplification for this policy and a
  sharpening of it: the same change made the directory business-wide, so a
  retention rule is written once for the business and there is no "the other
  outlet still has a copy" hiding place.
- `extended-offline-billing` (#34) owns a narrow device-cache lifetime for exact
  customer matches and persisted projections. That operational cache cap does not
  decide how long the authoritative global profile or historical transaction link lives.
- Location evidence is already framed as reviewable input rather than proof, so removing it later does not invalidate a verdict that was never supposed to rest on it alone.

## Open questions

- **What are the actual obligations?** India's data-protection regime places duties around retention and erasure. What applies to a business this size, and what a franchise agreement might add on top, needs a real answer from someone qualified rather than an engineering assumption.
- **Delete or anonymise?** Deleting attendance rows destroys the record that someone worked that day, which is a payroll and dispute problem. Dropping the *location* while keeping the check-in is very likely the right split, and it is a different feature from deletion.
- Does an employee get to see, or request removal of, their own location history? An asymmetry here is corrosive in a monitoring feature — the same principle that requires an employee's own history to show exactly what their manager sees.
- When a global customer is deleted or anonymised, what happens to the customer
  foreign key and name/phone snapshots on immutable outlet-owned orders and bills?
  Historical money must remain correct without retaining contact PII indefinitely.
  #32 makes the shape of this concrete: `customers.phone` is non-null and unique,
  so anonymising in place is not simply nulling a column, and `bills` keeps its
  own `customer_name` / `customer_phone` snapshots that a profile erasure does
  not touch. Erasing the profile and leaving the snapshots would be a policy that
  deletes the index and keeps the book.
- Does the policy apply retrospectively when it lands, or only forward?

## Trigger to promote

The roadmap's triggers stand — meaningful customer volume, or a franchise agreement specifying retention. Add one that fires earlier: **a full quarter of real attendance data in production**, at which point there is a genuine location history on real people with no stated lifetime and no answer for anyone who asks.

**Dependencies when seeded**: `attendance` (#5) live in production — which is the point, not a blocker. Interacts with [`audit-log`](./audit-log.md) and the delivered [`global-customer-identity`](../specs/global-customer-identity/spec.md) (#32), archived 2026-08-02.
