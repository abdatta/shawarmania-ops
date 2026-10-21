# Design: A trend can show its running total

## Context

`TrendCard` (`src/features/analytics/analytics-trend-card.tsx`) is the one trend card that both `ItemsPanel` and `SalesPanel` render. It owns the Chart / Table switch, kept in the address as `show=table`, and draws `AnalyticsChart` from the `series` and `axis` the panel hands it. Those series have already been through `trendView`, which classifies points as completed, ongoing or future and, for the Hour grouping, reorders hours around the cutover and trims to the trading hours. So the series the card receives are exactly the points, in exactly the order, the chart draws.

## D1. The running total is computed in the card, from the series it already has

`cumulativeSeries(series)` in `analytics-trend.ts` maps each series to running values, point by point, keeping every other field: label, interval and state. `TrendCard` applies it only when `show === 'cumulative'` and hands the result to the same `AnalyticsChart`. Applied after `trendView`, it accumulates in the order the chart draws, which is the cutover order on a one-day Hour chart. Trimmed hours are zero in every period, so trimming loses nothing from the totals.

- A point whose value is `null` and that carries no bills (D2) stays `null`. That is an earlier window that does not reach this far into the current one (Month's shorter months, `alignedTrend`), and it remains a gap.
- Otherwise the running total adds the point's value. A zero adds nothing, so the line runs flat.
- `state` is untouched, so `plotted()` keeps its rules: a future point is not drawn, and an ongoing point is hollow and reads **so far**. A future point's value becomes `null`, so inspecting it reads `— · not started` rather than the total so far beside "not started". An ongoing point with nothing yet now carries the total so far rather than zero, so it is drawn level with the point before it. That is right for a running total: "so far" at the same height is true, where a zero would have been a false drop.

Rejected: **computing the running total in each panel.** Both panels would need the same transform at the same place, after `trendView`. One call in the card that both panels share keeps them from drifting apart.

Rejected: **accumulating before `trendView`.** The Hour grouping reorders around the cutover inside `trendView`. Accumulating in clock order first would start a business day at midnight.

## D2. AOV accumulates the bills, not the averages

A bucket's AOV is `Math.round(revenue / orders)`. Adding averages is meaningless, and a running weighted average rebuilt from rounded averages drifts by up to half a paisa per bucket. So an AOV point carries the figures behind it, `bills: { revenue, orders }` (integer paise and a count) on `ChartPoint`, and the running AOV is `Math.round(Σ revenue / Σ orders)`: the same weighted counter AOV the headline uses, over a longer span.

- `periodTrend`, `alignedTrend` and `hourTrend` take an optional `bills` input. `SalesPanel` passes it only for AOV, so the points carry counter revenue and bill counts. `alignedTrend` attaches no bills to a point an earlier window does not reach, so that point stays a gap under D1.
- A bucket with no bills (value `null`, `bills.orders` 0) holds the running average. Before the period's first bill the running average is `null`, a gap, as AOV without orders already is.
- Money stays integer paise. The one division is the existing weighted-AOV division, rounded the same way.

Rejected: **turning Cumulative off on AOV.** The owner would meet a switch that works on two measures and silently does nothing on the third. A running average answers the real question: "is the average bill this month holding up?"

Rejected: **summing the averages anyway.** The result is a number with no meaning.

## D3. The switch and the address

`show` takes `cumulative` beside `table`. Absent, or any other value, means Chart, which is how the build before this change already reads it. The button sits between Chart and Table, with a rising-line icon (`TrendingUp`) and the accessible name **Cumulative**, matching Chart and Table's icon-only buttons. The chart's accessible name says what is drawn: `Revenue, running total`, or `AOV, running average`. The chart's `key` includes the mode, so a selected point does not carry across a switch.

Rejected: **a separate on/off toggle beside the switch.** Cumulative is one more way to read the trend, as Table is. A second control would give the card two switches for one decision.

## D3a. Running lines stay straight

Cumulative joins its points with the same straight segments as Chart.

Rejected after it was built: **gentle curves** (owner asked, 2026-10-18, for the averaging to feel smooth). A monotone cubic (Fritsch–Carlson, d3's `curveMonotoneX`) was built for every Cumulative line. It cannot overshoot, so a running total never seems to fall and an average shows no peak it does not have. Compared side by side on the demo (Revenue by day, AOV by day, Revenue by hour), it was barely distinguishable from straight lines: only a corner or two softened. That honesty is exactly why. A curve that may not bulge past its points looks almost straight between points this close together. It cost about 70 lines in the shared `AnalyticsChart` and a second line-drawing path that every later change to gaps, ongoing points or dashes would have to repeat. The owner dropped it on that trade (2026-10-18). The smoothness the owner wanted on AOV comes from the running average itself, which levels off as bills accumulate.

Rejected: **a Catmull-Rom or plain cubic spline**, which would show more. Both overshoot: a flat weekend after a busy Friday would bulge above Friday's total, so a running total would appear to rise and fall again.

## D4. What stays per bucket

The headline value, its chips, the caption, the table and its CSV keep reading the per-bucket series and the period totals. A table of running totals was not asked for, and the table's job is to reconcile to the bills, bucket by bucket. On every measure but AOV, the last point of a period's running line equals that period's total in the table. The exception is Sales' Revenue grouped by Hour, where the hourly figures are counter-only (the caption already says so) while the headline adds delivery.

## Money, RLS and offline

No RLS policy, no table and no offline path is touched. Money: running totals add integer paise, and running AOV is one rounded division of integer paise by a count (D2). No float is stored or shown unrounded.

## Version skew

No database object is touched, so a build published before this change keeps working against the same database. An address carrying `show=cumulative` opened by an older build shows the chart (D3). The change writes nothing anywhere, so there is nothing for a revert or an older build to live with, and no round trip to test.
