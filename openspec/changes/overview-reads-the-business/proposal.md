# Overview Reads the Business

> **Model:** current Codex model; no roadmap model prescribed. **Gate:** owners and managers read real, independently loading financial cards for every authorised outlet, with demo parity, source-page links, and attention totals identical to navigation.

## Why

Production Overview deliberately returns no money while demo shows an older design. The owner needs a compact financial home that answers today's counter activity, drawer position, completed monthly trading and work waiting behind navigation.

## What Changes

- Replace the selector and old cards with one outlet card containing four linked metrics: today's counter sales, expected drawer cash with Last Left and spent since, monthly revenue, and estimated operating P&L.
- Read monthly figures through yesterday's business date; on day one show the previous full month. Compare matching completed dates with shorter-month clamping, or full months on day one.
- Show a linked Open/Closed status with green/all, yellow/some, red/no activated tablets online. Retain the one-minute heartbeat and use a three-minute online threshold, separate from unresolved-work telemetry freshness.
- Render independently arriving metrics with reserved shimmers and individual errors/retries.
- Derive one attention row per badged navigation destination; count each blocked delivery integration once, including Hyperpure, alongside existing actionable work.
- Deep-link to the relevant outlet, today's billing, drawer, tablets or displayed Ledger month.

## Capabilities

### New Capabilities

- `outlets-overview`: scoped, progressive financial Overview and source links.

### Modified Capabilities

- `attention-badges`: page-level Overview summaries and distinct delivery integration problems.
- `ledger-statement`: address-selected outlet and month view.

## Impact

Overview UI, typed adapters and mocks, read-only database aggregate functions, attention sources, destination URL handling and tests. No new tables or broader financial permissions. Update docs/SCREENS.md, docs/DATA_MODEL.md, docs/TESTING.md and docs/LIMITATIONS.md before archive. Resolve openspec/todos/the-home-page-reads-the-money.md at archive.

## Non-goals

No new accounting basis, intraday delivery storage, outlet selector, business-health panel, offline tablet alerts, heartbeat cadence change, billing writes, automated archival or deployment. The owner separately requested a commit after verification.
