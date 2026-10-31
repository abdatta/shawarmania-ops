# Proposal: a-fixed-cost-row-opens-wherever-tapped

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · corrects `fixed-costs-are-spread-over-the-month` (D9) and `fixed-costs-show-paid-at-a-glance` · **Gate**: none — an owner and manager page away from the counter, and a revert cleanly undoes it; the new `e2e/fixed-costs.spec.ts` test fails with the fix reverted.

## Why

On the owner's phone a tap on a Fixed costs row often did nothing, on staging and production, while the same tap a little lower on the same row opened the fixed cost's page. The row is one link stretched over the whole row from its first cell, an `::after` overlay. The ring added by `fixed-costs-show-paid-at-a-glance` hangs from the *This month* paid line, which is `position: relative` to anchor it; a positioned element later in the row paints above the overlay, so a tap on the paid line (or its ring) hit a span with no handler. A hit test across all six demo rows at 375 px found 384 of 1,806 points dead, the whole upper half of the middle column; the same test on Outlets finds none. Nothing re-renders the list between touch and click, and nothing else covers it.

## What Changes

- The *This month* cell lets taps through to the row's link (`pointer-events-none`); it holds no control of its own, and the ring keeps its anchor.
- `DataTable`'s note on stretched row links says the rule: anything positioned in a later cell needs `pointer-events-none` unless it is a control.
- One e2e test sweeps every point of every row and fails on a point that reaches neither the row's link nor its Pay or Close, then taps Shop rent's paid line and expects its page.

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It lets taps through one cell of an owner and manager page and writes nothing.

## Non-goals

- No change to what a tap does, the press tint, the pause, or the Pay and Close pills, which stay above the link.
- No spec delta: D9 already says the whole row opens its page; the spec does not word taps.
- No sweep of other stretched-link tables. Outlets and Change gates have nothing positioned in a later cell today; the note in `DataTable` is what stops the next one.
