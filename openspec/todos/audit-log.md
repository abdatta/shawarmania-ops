# Audit Log

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Security

## Expectation

An immutable trail of who did what, queryable after the fact, that survives the row it describes being changed.

## Current behaviour

Accountability is recorded **on the affected row**: who voided a bill and why, who approved an attendance day and when and from where, who recorded an expense. Bills are append-only and a void never mutates the original sale, so the money path already resists quiet rewriting.

What is missing is everything else and one property:

- A menu price change leaves no record of who changed it or what it was before.
- Roster edits and account changes leave no history.
- Nothing outside a row would reveal that row being altered.

## Billing scope already owned by proposed changes

The current billing roadmap deliberately does not wait for a general audit log.
`billing-transaction-contract` (#33), `billing-live` (#10), and
`daily-cash-live` (#12) own the trail needed for money integrity:

- immutable order events for create, revise, cancel, pay, transfer, and recovery;
- compact command receipts for exact replay and idempotency conflicts;
- attributed void/replacement, correction, discard, and recovery facts;
- device-day seals and invalidation when later work arrives;
- preserved close snapshots and reconciliation exceptions.

Those records remain domain history, not a generic audit subsystem. This todo
must not duplicate them or weaken them later. Its remaining scope is change
history for mutable administrative and operational facts such as menu prices,
people/accounts, outlet configuration, inventory, and expenses.

## Why it is deferred

Sufficient for a small trusted team, which is an accurate description of the business today. The highest-consequence actions already carry an actor and a reason, and the two places where money could be quietly moved — voiding a bill, rewriting a signed-off day — are structurally blocked rather than merely logged.

## What already exists for it

- **Per-row actor and reason columns** on voids, attendance approvals, and expenses. Attendance approvals go further than the rest: the approver's own position is stored, and a recorded approval is immutable — correcting a mistaken one means changing the day's status, which leaves the original decision visible.
- **Append-only bills**, so a correction is a new record rather than an edit.
- **The signed-off-day rule** — a bill arriving after reconciliation raises an exception instead of silently changing a number a human approved.

An audit log generalises these. It does not replace them, and it should not be treated as a reason to relax any of them.

## Open questions

- **What is the actual requirement?** "Who changed this price" is a change history — cheap, per-table, useful immediately. "Prove this record was not tampered with" is tamper-evidence, much more work, and largely defeated if whoever holds the database credentials can also rewrite the log. These are different features and conflating them is how this becomes a project.
- Which non-billing tables? Logging everything is the expensive answer and
  produces volume nobody reads; the billing lifecycle already has its own trail.
- **Who can read it?** A log a Franchise Admin can read tells them what the owner did. A log only the owner can read is not much use in a dispute where the owner is a party. This is the awkward question and it is a governance one.
- Retention interacts with [`data-retention-policy`](./data-retention-policy.md) — an audit log is arguably the one thing that should outlive the data it describes.

## Trigger to promote

The first franchise dispute, or headcount where "a small trusted team" stops being an accurate description of who has access.

**Dependencies when seeded**: none structural. Most valuable after `billing-live` (#10) and `expenses-and-inventory-live` (#11), when the actions worth auditing are real rather than mocked.
