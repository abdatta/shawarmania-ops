# Sales and menu analytics

> **Model**: Codex · **Wave**: F · **Dependencies**: #10, #61, #68 · **Roadmap**: #71 (explicit owner request; leave missing numbers unused)

## Why

The owner needs to see which dishes sell, which lag, and whether sales improve over time, using a phone. The Supabase free plan makes bounded aggregate reads a requirement.

## What changes

A fifth navigation group, Analytics, contains **Items** and **Sales** for owners and outlet managers, scoped to one outlet. Items has one fixed-height Dishes card with All/Worst/Rising/Slow ordering, search and incremental internal scrolling. Full dish names, units, order share, prior changes, two-dish comparison, category bars and an expandable table/export show actual performance. Separate best/worst boards, Ideas and Browsing are removed by the owner's latest direction.

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
