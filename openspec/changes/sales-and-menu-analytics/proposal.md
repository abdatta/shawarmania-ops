# Sales and menu analytics

> **Model**: GPT-6.1 Sol · **Wave**: F · **Dependencies**: #10, #61, #68 · **Roadmap**: #71 (explicit owner request; leave missing numbers unused)

## Why

The owner needs to see which dishes sell, which lag, and whether sales improve over time, using a phone. The Supabase free plan makes bounded aggregate reads a requirement.

## What changes

A fifth navigation group, Analytics, contains **Items** and **Sales** for owners and outlet managers, scoped to one outlet. Items leads with a trend chart of dish units or dish revenue for all dishes, one dish or one captured category, against up to three earlier equal periods; below it, one fixed-height Dishes card with All/Worst/Rising/Slow ordering, search and incremental internal scrolling, and a Categories list with change against the previous period. Tapping a dish or category charts it. Separate best/worst boards, two-dish comparison, Ideas and Browsing are removed by the owner's direction.

Both pages offer compact 1d/7d/30d controls, defaulting to 7d, and custom dates. Sales has a page-wide Revenue/Orders/AOV selector and up to four equal-length periods. Revenue includes recorded counter and imported delivery gross; Orders and weighted AOV use settled counter bills only. Hour/day/week trends, weekday and Kolkata-hour charts, period rows and exports all follow the chosen metric. Hour grouping shows counter totals by Kolkata clock hour across each selected range; the bottom Hours graph uses grouped columns. A compact comparison pill opens choices labeled by total periods and their actual ranges. Charts respond to pointer, touch and keyboard inspection with exact figures and actual short date ranges.

One database aggregate RPC per view/range/outlet/comparison count transfers no raw bills or lines. Items requests two period summaries and dish/category aggregates, without daily, delivery or hourly rows. Sales requests daily and delivery summaries, without dish/category rows; hourly aggregates are bounded to 24 × selected period count. Changing metric or grouping reuses the snapshot. Demo history remains bounded and internally consistent over more than three months.

## Gate

Both pages work live and in demo; navigation and deep links work on phone/tablet in both themes. Settled snapshots reconcile, voids/packaging and missing delivery imports remain honest, AOV is weighted, empty periods and no-baseline changes are explicit. Managers cannot read another outlet through crafted requests. View-specific payloads, requested-period bounds, interactive chart details and no extra reads for metric/group changes are proved. All applicable repository gates pass.

## Pattern clarity

The lower pattern cards name the selected metric and aggregation explicitly. Weekday Revenue/Orders show daily averages by weekday; hourly Revenue/Orders show each clock-hour total divided by the selected day count, including zero-sales days. AOV remains weighted counter revenue/orders. No chart is removed in this follow-up; overlap is assessed separately for the owner.

Solid rounded hourly comparison columns replace hatch patterns, with numbered date-range legends and a focused trading-hour axis across all selected periods. Main Hour totals/table retain all 24 hours. All theme colors use semantic data-series tokens with contrast checks.

## Non-goals

Outlet comparison, automated menu changes, recommendations, menu engagement tracking, GA/account creation, customer analytics, profit without recipe costs, inferred delivery order/item data, production publication and automatic archive. The initial unpublished website collector is removed; the website checkout returns to its original state. Tracking and experiment advice are deferred into the behavior backlog.

## Durable documentation

Update SCREENS, DATA_MODEL, SECURITY_AND_PRIVACY, OPERATIONS, TESTING and DEMO_MODE. No website deployment or production schema write is part of this implementation.

## Owner review, 2026-10-09

After using both pages the owner asked for:

- **Items charts items over time.** Comparing exactly two dishes is removed. Items gets the same kind of trend chart as Sales, of dish units or dish revenue, against earlier equal periods, for every dish together, any single dish, or any captured category. The goal named: see which dishes and categories perform well or badly, and how that changed across comparable periods.
- **Sales shows one trend, two ways.** The Revenue chart and the Days list showed the same figures twice. They become one card with a Chart / Table switch, and neither view drops data: the table holds every bucket of every compared period, with the change.
- **The weekday-average card is dropped.** It averaged each weekday's revenue within each period. On the default 7-day range every weekday occurs once, so it only re-ordered the daily chart; its one use (Saturdays against Tuesdays over 30 days or more) did not justify a card the owner could not read.

Rejected along the way: sending a series per dish inside the Items snapshot (about a hundred dishes times every day of two windows, on every page view) in favour of reading one subject's series only when it is charted; and moving Customers into Analytics inside this change, which stays the owner's call (see design).
