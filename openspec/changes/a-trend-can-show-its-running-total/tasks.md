# Tasks

## Build

- [x] 1. `ChartPoint` gains optional `bills: { revenue, orders }`. `periodTrend`, `alignedTrend` and `hourTrend` take an optional `bills` input and attach it to each point. `alignedTrend` attaches none to a point an earlier window does not reach (design D2).
- [x] 2. `cumulativeSeries(series)` in `analytics-trend.ts`, per design D1 and D2, with unit tests: additive running totals with a flat zero; a `null` without bills stays a gap; running AOV from bills, held across a bill-less bucket and `null` before the first bill; `state`, `label` and `interval` preserved; the last point equals the period's sum.
- [x] 3. `SalesPanel` passes bills for AOV only, on the day, week and hour paths. `ItemsPanel` is unchanged.
- [x] 4. `TrendCard`: `show=cumulative` in the address, the Cumulative button between Chart and Table, the running series to `AnalyticsChart` with the accessible name `<title>, running total` (`running average` on AOV), and the mode in the chart's `key` (design D3).
- [x] 5. Component tests: the switch keeps `show=cumulative` and presses its button; inspected points read the running figures on Sales Revenue and AOV and on Items; the table and the headline are unchanged.
- [x] 6. Demo browser test (`e2e/analytics.spec.ts`): on Sales and Items, Cumulative draws running figures whose last point matches the table's total, survives a reload, makes no backend request, and has no horizontal scroll on phone and tablet in both themes.

## Close

- [x] 7. Run every gate CI runs locally where it can: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run test:e2e:on`. Inspect the built page on a phone and a tablet viewport in light and dark, with the console and network clean.
- [x] 8. PHASE GATE (no roadmap row, so no wave checkpoint): on Analytics → Items and Analytics → Sales, Chart | Cumulative | Table switches the trend; Cumulative draws a running line for every compared period and a running average on AOV; the table, CSV and headline are unchanged; the choice survives a reload; and switching makes no request.
