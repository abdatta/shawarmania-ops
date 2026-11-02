# Proposal: revenue-tile-opens-analytics

> **Model**: Opus · **Kind**: small correction, not a roadmap change · corrects `outlets-overview` · **Gate**: none — a link on the owner's and manager's Overview, away from the counter's run time, and a revert cleanly undoes it; the Overview link test fails with the fix reverted.

## Why

On Overview, the month's revenue tile and the P&L tile both opened the Ledger's month view, so two tiles led to the same page (owner, 2026-11-01). The month's revenue already has a page of its own: Sales with Month selected shows the same figure, by day, against earlier months.

## What Changes

- The month revenue tile opens that outlet's **Analytics → Sales** with the **Month** shortcut on and **Revenue** as the measure: the address the Month button itself writes (`from` the 1st, `to` today, `grain=day`, `align=month`, `metric=revenue`).
- P&L keeps opening the Ledger's month view.
- The `outlets-overview` requirement "Metrics link to the displayed source scope" says so.

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It changes where a link goes and writes nothing.

## Non-goals

- Arriving from the tile does not overwrite the range Sales remembers; only a range chosen on the page is remembered.
- The Counter / Delivery choice Sales remembers is left as it is. Where the reader last chose Delivery, Sales opens on Delivery's Orders, because Delivery carries no money.
