# Aggregator Settlement

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Reporting

## Expectation

Aggregator revenue in reports and the P&L reflects what the business actually receives — net of commission — rather than the order value the customer paid. The owner can see both figures and tell them apart.

## Current behaviour

Swiggy and Zomato orders are recorded as bills at order value, distinguished by their payment method. That keeps revenue and item-level sales complete, which is why it was done this way.

But **the recorded amount is not what lands in the bank.** Aggregators settle later, net of commission. Aggregator revenue is therefore systematically overstated relative to cash actually received, and the overstatement scales with aggregator share of trade.

## Why it is deferred

This is the single largest known inaccuracy in the P&L, and it is deferred anyway — because fixing it means either a manual settlement-entry surface or an aggregator integration, and neither earns its cost while aggregator orders are a small slice of revenue. A P&L that is uniformly optimistic on a small slice still answers "is this shop making money this month?". The same P&L becomes misleading once that slice is large.

The failure mode to watch is not the inaccuracy itself, which is documented, but a figure from that screen being quoted somewhere it will be taken as net.

## What already exists for it

- **Aggregator orders are identifiable from day one** — the payment method distinguishes `swiggy` and `zomato` from cash, UPI and card on every bill. Historical aggregator revenue can be found without guessing, so a settlement layer can be applied retrospectively to bills already rung.
- **Bills are append-only with line-item snapshots.** A settlement record attaches alongside a bill rather than rewriting it, so reconciling a payout never mutates the sale.
- The P&L already states which basis it is showing, so adding a gross/net distinction extends an existing habit rather than introducing one.

## Decided since (owner, 2026-07-28)

- **Manual settlement entry first** — confirmed; integration only if volume ever justifies it.
- **The owner enters it, from anywhere.** Settlement and commission figures live in the owner's aggregator dashboard; no Franchise Admin can see or verify them, so making an FA transcribe them would be worse attribution, not better. The general principle set that day: *record money where the knowledge lives.* This makes the todo a customer of the owner's non-cash write path, folded into `multi-outlet-people` (#22) on 2026-07-29 — which must land first.
- **Settlement entries never touch drawer math.** They are non-cash by nature, and the day-close arithmetic only counts cash — so this capability is drawer-safe by construction, no new enforcement needed.

## Open questions

- Manual entry's exact home: an expense with a category, or a deduction on the revenue side? It changes what the P&L's "sales" line means.
- Is settlement reconciled per order or per payout batch? Payouts are understood to batch across several days, which does not line up with the business-date model everything else uses — this needs confirming against a real settlement statement before any design.
- Does the P&L show gross and net, or only net? Showing only net loses the item-level sales picture that made recording aggregator orders as bills worthwhile in the first place.
- Commission rates differ by platform and change with contract terms. Is the rate per outlet, and does it need to be effective-dated so a historical period recomputes on the rate that applied then?
- What happens to a payout that arrives short, late, or not at all? That is a reconciliation exception, and the system already has a shape for those.

## Trigger to promote

Aggregator volume grows enough to distort a decision — concretely, when the owner would act differently on gross margin than on net margin for an outlet.

**Dependencies when seeded**: `owner-console-live` (#13), which owns the P&L and reports.
