# Owner Break-Glass Writes

**Type**: Feature · **Status**: Decided in principle (owner, 2026-07-28), awaiting need · **Area**: Roles

## Expectation

The owner (Super Admin) can, from anywhere, record or correct the operational
facts that only they know or that cannot wait — a missed expense, a stock
correction — and every such entry is **visibly the owner's**: attributed on the
row, badged wherever it is read, never mistakable for the outlet manager's own
record-keeping.

## Current behaviour

The Super Admin is read-only on every operational write — expenses, stock
movements, daily cash, attendance, alerts. That is deliberate: writes in this
system are testimony ("I counted this drawer"), and single-writer discipline is
what keeps a shortage dispute short. But it also means a fact the owner learns
remotely (a supplier paid digitally, a platform invoice) has no path into the
books except asking the FA to transcribe a number the FA cannot verify.

## The settled boundary (owner, 2026-07-28)

- **In scope when built**: non-cash expenses, stock corrections — writes that
  are visibly attributed and rare by intent. The reads side needs nothing:
  attribution is already enforced on every write in the system, so a
  "recorded by the owner" badge is presentation, not new bookkeeping.
- **Never in scope**: anything cash. A non-cash entry is *mathematically
  incapable* of touching a drawer count, which is the safe line. The drawer —
  cash expenses, the day close — stays the Franchise Admin's alone, always.
  Bills stay on the device/shift path (see #9's emergency-session design
  question for the tablet-is-dead case).
- **Rejected alternative**: a blanket role hierarchy (SA inherits FA inherits
  Biller…). Seeing and doing are different: seniority already widens what the
  owner *sees*; it must not widen what they can silently *attest to*. Two
  possible writers per record would make every shortage investigation start
  with "did you touch anything?", and would make the most-phished account in
  the company the one able to fabricate any record anywhere.

## What already exists for it

- Every operational write already stamps the actual author, enforced in policy
  — no schema work needed for honest attribution.
- The aggregator settlement todo (`aggregator-settlement.md`) is the first
  concrete customer of this capability: settlement and platform costs are
  facts that live in the owner's dashboard, not at any outlet.

## Open questions

- Is this a standing capability or an "acting as manager of outlet X" mode
  (see `role-grants-one-login-many-hats.md`)? The two can be the same feature.
- Does the alert stream note owner-entered records automatically, so an FA is
  never surprised by a row appearing in their books?

## Trigger to promote

The first time the owner actually needs to enter or fix something remotely —
or the aggregator-settlement todo graduating, whichever comes first.
