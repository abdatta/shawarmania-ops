# The Owner Console Was Withdrawn

**Type**: Withdrawn plan · **Status**: Closed unless the trigger fires · **Area**: Insight

## What was withdrawn

Roadmap **#13 `owner-console-live`**, on 2026-08-31, along with the four
demonstration surfaces it existed to promote: the cash-basis P&L (both roles),
the two-outlet period comparison, the period reports, and — separately decided,
same day — the outlet alert thread and the stock ledger.

`#51 navigation-groups-and-surface-cull` deleted the screens. The specs
`profit-estimates` and `inventory-ledger` and `outlet-alerts` were removed whole;
`cross-outlet-oversight` lost its comparison and reports requirements and kept
everything else.

## Why

The owner reviewed the app against the business as it actually runs and
concluded these answer questions nobody at Shawarmania asks. The Ledger already
says what a day took and what it cost, derived from recorded rows with no typed
figure on it. An estimate sitting on top of that is a second number to reconcile
rather than an answer, and the reconciling would land on the one person the app
exists to save time for.

The owner's words, in the session that decided it: *the app looks complete,
anything left was past planning that we might be scrapping now.*

This is a fact about August 2026, not a law. It is recorded rather than deleted
because the reasoning behind the original plan is still sound if the business
changes shape.

## What the plan actually contained, in case it is ever wanted

The full proposal is in git history at
`openspec/changes/owner-console-live/proposal.md`, deleted by #51. Its four
load-bearing ideas, none of which were wrong:

- **Two named expense bases, never mixed.** *Purchase basis* is
  `revenue − all expenses`; *consumption basis* is
  `revenue − non-raw-material expenses − inventory consumed`. Neither is more
  correct in general and silently mixing them is always wrong, so the active
  basis is stated on screen and a test fails if raw materials are counted in
  both places.
- **Two clocks, deliberately different.** Revenue groups an immutable bill by the
  originating order's `business_date`, including an order paid after cutoff.
  Drawer and payment-method reports group by the drawer's own instants. These
  disagree by design, and a report that silently picked one for both would be
  wrong for the other.
- **A ceiling, not a figure, while commission is undetermined.** Any period
  containing aggregator revenue whose commission has not settled reports a
  ceiling and says so, rather than a precise number that will move.
- **Reports produce no file.** While the figures were demonstration data, there
  was deliberately no export path. That property survives its own removal — there
  is now no export anywhere, which is strictly stronger.

## What it would cost to bring back

The database was never touched. Bills, expenses, the drawer and the aggregator
settlements all still carry everything a P&L would read, and
`cross-outlet-oversight` still supplies the outlet switcher and the per-outlet
day view. What would have to be rebuilt is the surfaces and the two-basis
arithmetic — a change of its own size, not a gate flip.

## Trigger to reopen

The owner asks what a period actually earned and the Ledger cannot answer it; or
a franchisee, a lender or an accountant needs a stated-basis profit figure the
business does not currently produce; or aggregator commission reconciliation
(`aggregator-settlement.md`) needs somewhere to land a net figure.

## The first of those fired on 2026-09-01, and #52 answered it

The owner opened the Ledger's month view, found it reported the drawer and
nothing else, and asked for the P&L back. **`#52 restore-the-month-pnl` restored
the profit figure**, and `profit-estimates` returns with it — narrowed to cash
basis, and now naming the Ledger month as the surface that must state that basis,
which the original requirement could not, having no reader to name.

It cost far less than "a change of its own size" estimated above, and the reason
is worth keeping: the derived month reader was **already computing** every figure
the P&L needed, for all thirty-one days, and discarding all but eight drawer
fields per day. No migration, no new query.

**The other three are still withdrawn.** The two-outlet comparison, the period
reports and the export path were not part of the ask and remain deleted on the
owner's review. The two-basis arithmetic did not come back either: stock is still
not valued, so cash basis remains the only honest basis available, and the
consumption basis returns with inventory or not at all. Reopen this note if one of
those is what somebody wants.
