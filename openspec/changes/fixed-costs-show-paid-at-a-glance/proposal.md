# Proposal: fixed-costs-show-paid-at-a-glance

> **Model**: Opus · **Kind**: small owner-console UI change, not a roadmap change · touches the Fixed costs list · **Gate**: none — display only, away from the counter's run time, and a revert cleanly undoes it; `fixed-costs.test.tsx` passes, and its new test fails without the change.

## Why

The Fixed costs list says what each cost has had paid this month in words, *₹4,000 of ₹12,000 paid*, and a column of those has to be read row by row to find what is still open. The owner wants it seen at a glance (2026-10-30): a ring that fills as a cost is paid and turns into a tick once it is. This reverses the 2026-10-19 call of no bar on that column, which was made when part payments were thought to be occasional.

## What Changes

- **A ring beside each running cost's This month figure**, in the gap left of it, so the figures stay aligned under the heading.
  - **Nothing paid**: an empty ring, the track only.
  - **Part paid**: the ring fills in amber in proportion to what is paid.
  - **Everything paid**: the attendance list's *Present* mark, a green outline circle with a green tick (`CheckCircle2`, `text-success`), not a filled disc.
- **What the ring counts**: everything the row owes now. A row with an overdue month counts it in the whole: Priyanka at *₹0 of ₹9,000 paid + ₹3,300 overdue* is an empty ring of ₹12,300, and it shows the tick only when this month and the overdue are both paid. Money paid ahead does not overfill it.
- A stopped cost has no ring.

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It changes how the owner's figures are drawn and writes nothing.

## Non-goals

- The words stay; the ring is aria-hidden, since the figure beside it already says the same thing.
- No ring on a cost's own page or on the Ledger: the owner asked for the list.
- No spec delta: fixed costs has no spec of its own yet; this folder carries the rule until its change is archived.
