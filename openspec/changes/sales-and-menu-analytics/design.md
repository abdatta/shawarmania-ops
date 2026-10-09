# Design

## Phone first

Reuse the app's outlet chips, date bar, FormSheet choices, cards, change chips and bars. Items opens directly on a 320px internally scrolling Dishes card; All sorts best first, Worst reverses units, Rising/Slow require a nonzero preceding baseline. Full names wrap. Twelve rows render initially and more append inside the card. Search/filter/date/outlet changes reset the list. Comparison selects exactly two dishes. Categories and detailed figures are secondary; Ideas/Browsing are absent.

Sales uses compact Hour/Day/Week and metric sheet triggers, plus a distinct smaller comparison pill with an icon and selected total-period count. Its sheet shows Current only or 2/3/4 periods with actual date ranges. Date presets are 1d/7d/30d, default 7d. Charts use semantic theme tokens, solid comparison colors and real date-range legends. Pointer/touch selects the nearest point; keyboard arrows/Home/End inspect points. Zero-order AOV is a gap and an em dash, never zero or infinity. Hour labels use Asia/Kolkata; billing business dates remain explicit.

Comparison columns use solid semantic colors: orange current, slate preceding, blue earlier and violet oldest; no hatch fills. Rounded bars have a visible gap within each hour and a wider gap between hours. Numbered legend swatches and detail rows identify the stable left-to-right period order without relying on color alone. The lower hourly plot trims unused leading/trailing hours across all selected periods, with one neighboring hour retained on each side; zero hours within that span remain visible. An entirely empty plot keeps all 24 hours. Main Hour totals/table retain all 24. Tick labels adapt to the displayed span. A subtle selected-hour background and matching period markers make inspection clearer without changing data or requests.

## Financial basis

Settled bill total paise drives counter revenue/order count; voids are excluded. Item units and line revenue use captured item snapshots and exclude packaging. Item revenue excludes bill-level discount allocation. Revenue includes aggregator_channel_days gross facts, before commission; missing imports are unknown and provisional source-day rows are disclosed. Delivery order counts and timestamps are unavailable, so Orders/AOV/hour charts use counter bills. AOV divides period/bucket counter revenue by period/bucket counter orders, not averages of daily AOV. Weekday Revenue/Orders are daily averages including selected zero-sales days; weekday AOV is weighted.

## Periods

Current and up to three adjacent preceding inclusive windows have equal lengths. Trend buckets align older dates by elapsed day before grouping by day or Monday week. Boundary groups include only selected dates; tooltip labels show each actual historical bucket range. Hour grouping uses the existing period/hour aggregates (clock-hour patterns, counter only), not new per-date hourly rows. Bottom hourly averages use solid grouped columns and the same touch/keyboard details. Secondary graphs stay full width on portrait tablets. The global period selector governs all Sales charts and detailed table/export. Items compares only the immediately preceding period.

## Pattern labels and averages

Lower titles follow the measure: Daily average revenue/orders, Hourly average revenue/orders, and Average bill by weekday/hour (AOV). Short subtitles identify By weekday or Per day, source coverage and Kolkata where relevant. Hourly Revenue/Orders divide the existing aggregate by the inclusive selected day count, including zero-sale days; AOV remains weighted and null without orders. Main Hour grouping and its rows/export retain counter totals, so totals reconcile to captured bills. This display derivation adds no database reads or payload. Keep all cards while reporting overlap: weekday vs daily trend on 7d, hourly pattern vs main Hour grouping, and period rows vs table/export.

## Low egress

sales_analytics(outlet,from,to,view,periods) validates authority before scanning settled bills. Ranges are bounded to 1–92 days and 1–4 windows. The app explicitly requests items/2 or sales/N. SQL items responses collapse daily facts into two summary rows and omit delivery/hours; Sales omits items/categories and avoids reading bill lines. Sales hours group by period/hour, at most 96 rows. No identities or raw tickets cross the adapter. Metric/group controls are excluded from the read key, so they reuse one in-memory snapshot. Date/outlet/view/count changes invalidate it; there is no polling or realtime subscription. No durable aggregate cache is introduced before measured need because void/import updates must remain visible on a fresh read.

## Scope and safety

Owner/outlet-manager authority comes from current assignments, with foreign-outlet and staff requests rejected by the RPC. Demo uses the same contract over shared mature bills without backend requests. The unpublished collector table/RPC/cron and website changes are removed rather than deployed. Recommendations and telemetry belong to a separately approved future change. The user requests committing and pushing the verified change on a separate branch. No production write, deployment or archive is performed.
