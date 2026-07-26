# Proposal: ui-billing-counter

> **Model**: Opus · **Wave**: C · **Depends on**: #3 · **Gate**: a full order can be rung and settled in demo mode on a tablet viewport; whole menu visible without scrolling; optional customer fields never block settling.

## Why

The hardest UI in the product, and the one that most benefits from being designed against mocks: speed at a counter is a matter of layout, target size and tap count, and all three iterate far faster with fake data than with a backend behind them.

It is also the single most compelling screen in a demo — this is what the business *is*. It keeps its own change rather than joining the other UI work because it is tablet-first, design-heavy, and the centrepiece of both the demo and Wave D.

## Scope

- The billing screen from `docs/SCREENS.md`: whole menu visible at once, tap to add, tap again to increment, one-tap payment method, settle.
- The bill panel with running total in Lilita One at display scale, tabular figures.
- Optional customer name and phone that never block settling.
- All six payment methods, with cash visually distinct because it alone touches the drawer.
- Shift unlock and handover screens.
- The sync indicator in its mocked states — synced, N pending, and the escalated warning — so the offline experience can be reviewed before the queue behind it exists.

## Non-goals

- No real bills, no outbox, no server bill numbers — #9 and #10.
- Record-only. No printing, GST, or digital share.
- No bill history or void — that ships with #10.

## Design questions to settle during `/opsx:propose`

- Quantity adjustment inline on the tile versus in the bill panel, judged against one-handed use.
- Whether the customer field is free text only, or offers select-from-history — the brief says "enter **or select** the customer name" and the `customers` table exists for exactly this. Decide what v1 ships and design the field so the other can be added without relayout.
- What the provisional bill reference looks like, so it is obviously not a real bill number to a biller or a customer.
- How a settle is undone in the seconds before the next customer, without introducing bill editing.

## Docs to update before archiving

`docs/SCREENS.md`.
