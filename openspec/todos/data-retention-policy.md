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
- Customer records carry first-seen and last-seen timestamps, so "no visit in N months" is expressible without adding anything.
- Location evidence is already framed as reviewable input rather than proof, so removing it later does not invalidate a verdict that was never supposed to rest on it alone.

## Open questions

- **What are the actual obligations?** India's data-protection regime places duties around retention and erasure. What applies to a business this size, and what a franchise agreement might add on top, needs a real answer from someone qualified rather than an engineering assumption.
- **Delete or anonymise?** Deleting attendance rows destroys the record that someone worked that day, which is a payroll and dispute problem. Dropping the *location* while keeping the check-in is very likely the right split, and it is a different feature from deletion.
- Does an employee get to see, or request removal of, their own location history? An asymmetry here is corrosive in a monitoring feature — the same principle that requires an employee's own history to show exactly what their manager sees.
- Customer records feed visit counts and spend totals. Does removing the person keep the aggregate?
- Does the policy apply retrospectively when it lands, or only forward?

## Trigger to promote

The roadmap's triggers stand — meaningful customer volume, or a franchise agreement specifying retention. Add one that fires earlier: **a full quarter of real attendance data in production**, at which point there is a genuine location history on real people with no stated lifetime and no answer for anyone who asks.

**Dependencies when seeded**: `attendance` (#5) live in production — which is the point, not a blocker. Interacts with [`audit-log`](./audit-log.md) and [`cross-outlet-customer-identity`](./cross-outlet-customer-identity.md).
