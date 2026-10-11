# Design

## Incomplete intervals and visible points (owner review, 2026-10-10)

This section supersedes the initial trailing-zero draft and its tests. The production-data preview was reviewed with three refinements: elapsed zero hours are complete, a nonzero ongoing point may be hollow, and dots must remain visible without hover. The owner has approved implementation and deployment. Prototype build/visual checks are separate from application verification, which is recorded in the follow-up evidence report.

### Clock-based interval state

Pass the selected outlet's cutover and a shared injectable current instant into the presentation layer, alongside the already-resolved business date. Keep stored business dates authoritative. Use the domain's Kolkata business-day helpers to map each selected interval to its included start/end instants; classify completed when its end is at or before now, ongoing when start <= now < end, and future when its start is after now. Do not infer state from a run of zeros. Recompute at hour/cutover boundaries and on foreground return, without adding an analytics RPC for presentation changes; preserve the existing data-refresh policy and freshness disclosures.

For one-day Hour trends, map before-cutover clock hours to the next calendar date. Order the axis by the outlet's trading day rather than 00–23, consistently across current and compared days. Support non-midnight and fractional-hour cutovers: an existing clock-hour aggregate that straddles cutover covers both included pieces and remains unfinished until its last included piece closes; do not split its values or invent per-instant sales from an aggregate. Define and test its labels and chronological placement explicitly during implementation. Day buckets end at their business-day cutoff; Week buckets use only the selected dates, and a partial selected week ends at the cutoff following its final included business date. A bucket containing the ongoing business date is unfinished even though earlier days contributed sales. Historical comparison buckets use their own dates and remain completed.

Multi-day Hour trends and lower clock-hour pattern columns combine repeated hours across dates. They remain aggregate patterns, with their existing totals and inspection; do not assign a single clock interval's hollow/open state to them. The incomplete selected-period disclosure still qualifies their current totals. AOV without orders remains null and an em dash regardless of interval state.

### Rendering and exact values

Carry explicit completed/ongoing/future presentation metadata separately from the numeric value. Completed non-null points are filled and connected, including zero. Ongoing nonzero points are connected and hollow. Ongoing zero/null and future points render no dot and no segment into or out of the point. The line ends at the previous plotted point, which may itself be a completed zero; do not search backward for the last nonzero sale. Completed null remains a gap. An all-zero series can still have completed zero points; an ongoing day with no sales has no invented point for today.

Render every eligible dot without hover on hourly, daily and weekly lines, for all compared series, using the existing short-series dot's outer size (3.5 SVG units). A hollow dot has the same outer bounds: inset the centered outline by half its width, with a surface-colored center masking the line underneath. Use semantic tokens in both themes. Hover, touch and keyboard still expose exact details and keyboard focus, without changing point eligibility or size.

Preserve recorded integers/nulls in totals, tables and CSV. Ongoing inspection/table values say **so far**, whether zero or nonzero; future cells/details say **not started** without describing zero as a completed result. State does not change the denominator, comparison arithmetic, or exported numeric values. A completion-state column in CSV is unnecessary for this follow-up.

### Axes, demo and verification

Retain the existing leading active-hour trim across compared series. For a current one-day view, retain the ongoing hour and unfinished business-day tail instead of trimming them away after the final sale. Keep completed zeros and earlier comparison points in that span; the table uses the same visible span. Historical windows and multi-day hour patterns retain their existing trim. This supersedes the later trading-hour trim description for current one-day windows. If a component's layout changes, reshape its shimmer in the same implementation.

Use a deterministic injected clock in tests and review fixtures. The frozen production capture uses its captured instant rather than the computer's later time; its 23:30 hollow-dot demonstration is explicitly a style example, not a historical report. Production aggregates remain ignored and outside the browser's live adapter and demo store. No real bills, identities, credentials or dumps enter tracked files.

Demo must include a visible nonzero ongoing point and an observable zero ongoing case, backed by shared demo bills and their genuine timestamps/business dates. First inspect the existing partial-day scenario; change it only as needed, then update every affected bill line, total, category, hourly/daily series, drawer/ledger/delivery relationship and dependent fixture expectation. Never patch just the chart series. Freeze the clock for deterministic demonstrations, keep mature history complete, and verify both outlets across cutoff and midnight boundaries. Demo stays isolated from real data.

Rejected: hiding all trailing zeros (erases completed quiet hours), marking every point in today's business date unfinished (ignores elapsed intervals), larger hollow markers (changes visual weight), hover-only dots (loses the production affordance), extrapolated tails (invented sales), replacing stored zero with null (changes meaning), and importing production aggregates into demo (breaks the shared scenario). No database schema, RLS, money arithmetic, offline or feature-gate change is required; metadata stays presentation-only and the typed adapter boundary remains intact.

## Inclusive dates and measure shares (owner, 2026-10-10)

Both pages default to `[today - 6, today]`, with 1d/7d/30d selecting `[today - (n - 1), today]`. Today continues to resolve through the outlet's Asia/Kolkata cutover. Explicit URL dates stay authoritative; next-period navigation may end on today, and invalid deep-link recovery uses the inclusive seven-day fallback. The existing incomplete-period disclosure stays.

Each opening of Dates takes the current valid range (or the fallback) and its inclusive span. The first edited endpoint becomes the anchor; repeated edits of it shift the opposite endpoint by that span. An explicit edit of the opposite endpoint unlocks both for the rest of that sheet visit. Apply commits once; cancel discards the draft; reopening starts fresh. If a shift crosses today or the supported calendar bounds, Apply stays disabled and the second endpoint can correct it. Do not silently clamp or shrink the chosen span. Manual dates preserve grouping.

Replace user-facing quantity terminology with Items/Items sold, including accessibility text, explanations, tables and exports; internal `units` payload/URL keys stay compatible. Replace order-share labels and the Dishes order-count header with the selected measure's total. Dish and category share is `row value / sum(all snapshot item values)` for the current window. Use the unfiltered full snapshot, including captured retired sales and Uncategorised; the chart subject, list filters and search never alter the denominator. Zero totals show an em dash, zero rows with a positive total show 0%, and whole-percent rounding can keep totals from being exactly 100%. Revenue is captured line revenue less line discounts, excluding bill-level discount, tax, rounding, packaging and delivery; it is not the Sales revenue headline.

The category layout gains a share row; reshape its loading reserve in the same change. Remove the order-count column from the Items export. No RLS, money arithmetic, database schema, offline semantics, feature gates or adapter contracts change. Shares derive from existing aggregate integers, without new reads. Rejected: retaining order penetration (a different question than the selected measure), changing denominators with filters (unstable shares), or renaming backend keys (unnecessary contract churn).

## Phone first

Reuse the app's outlet chips, date bar, FormSheet choices, cards, change chips and bars. Items opens on its trend card (see Trend card), then a 320px internally scrolling Dishes card; All sorts best first, Worst reverses units, Rising/Slow require a nonzero preceding baseline. Full names wrap. Twelve rows render initially and more append inside the card. Search/filter/date/outlet changes reset the list. Every dish and category row is a button that charts it. Categories show units and change against the previous period. Two-dish comparison, Ideas and Browsing are absent.

Both pages use compact Group by and Measure sheet triggers (Sales: Hour/Day/Week and Revenue/Orders/AOV; Items: Day/Week and Units/Revenue), plus a distinct smaller comparison pill with an icon and selected total-period count. Its sheet shows Current only or 2/3/4 periods with actual date ranges. Date presets are 1d/7d/30d, default 7d. Charts use semantic theme tokens, solid comparison colors and real date-range legends. Pointer/touch selects the nearest point; keyboard arrows/Home/End inspect points. Zero-order AOV is a gap and an em dash, never zero or infinity. Hour labels use Asia/Kolkata; billing business dates remain explicit.

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

## Trend card (owner review, 2026-10-09)

Both pages lead with one shared trend card: the measure's current-period total, its change against the previous period, and a Chart / Table switch kept in the address (`show=table`), so a reload or a change of charted subject keeps it. The table holds every figure the chart draws: one row per day, week or hour of the current period (newest first for days and weeks), one column per compared period headed by its numbered legend badge and actual range, exact to the paisa, a Change column for current against previous, and the CSV export. The separate Days list, the bottom Table & export and the weekday-average card are removed; the hourly-average card stays.

Items charts `Units` or `Dish revenue` (line total less line discount, counter only), by Hour, Day or Week; Day stays the default. Hour is the bill's Kolkata order time, totalled across each window, as Sales groups its hours: without it a one-day range is a single dot. Its subject is All dishes, one dish or one captured category, chosen from a picker above the card title or by tapping a row, and kept in the address (`dish=<key>` or `category=<name>`). Week grouping and earlier-period alignment are the same code as Sales (`periodTrend`).

The subject's series is a separate read, `sales_analytics_series`, returning `{from, units[], revenue[]}` for every day of every window and `hourUnits[]`, `hourRevenue[]` with 24 clock hours per window, current window first (at most 96 each), so switching to Hour reads nothing. It is read when a subject is charted, after the snapshot, and kept for the life of the page, so going back to a dish already charted costs nothing. Measure, grouping and Chart/Table never read. Sending every dish's daily series in the snapshot was rejected: about a hundred dishes times up to 184 days on every view, almost all of it never looked at.

A chart is focusable so the arrow keys inspect it; it shows the app's focus ring only when reached by keyboard, never after a tap or click, which already shows its point and figures.

Rupee figures in cards read whole from ₹100 and with two paise digits below it (`₹10.50`, never `₹10.5`); the table keeps exact paise. Count axes put their half-way line on a whole number.

## Customers under Analytics (owner, 2026-10-09)

Customers moves from Setup to Analytics, after Items and Sales, for owner and manager alike: it reads who the regulars are, how often they come and what they spend, and sets nothing up; gold is set at the counter as well. It had sat beside Team since 2026-09-18 as the other list of people the owner curates. Only the navigation group moves; the address stays `customers`, so every link still works. Customer analytics to come is recorded in the backlog as `customer-analytics`, not built here.

## Review corrections (2026-10-09)

- The migration is dated `20261012000000`, after the newest migration on main, so `supabase db push` applies it in order; its pgTAP file is `82_`, since `79_` was taken.
- Both RPCs refuse a deactivated account whose assignment lingers (`app_account_active()`), as every other owner/manager RPC does.
- Item units per day are pre-aggregated rather than a correlated subquery per day over every line.
- A dish's name is its current menu name where the dish still exists, else its latest captured name.
- The mature demo history is built with indexed lookups (about 0.1 s instead of about 0.6 s on every demo load and reset), runs to yesterday so the default 7-day range is not a false collapse, and captures every line's category as the counter does. Its delivery imports still stop four days back, leaving the rehearsed delivery days alone.

## Three or four periods read as a trend (owner, 2026-10-09)

A change against the last period contradicts a comparison of four. With one earlier period nothing changes: the chip is `+15%`. With two or three:

- **Direction.** A least-squares line through the period totals, oldest first, its slope taken as a share of their average: `↗ 9% / mo`, `↘ 12% / mo`, or `→ steady`. It calls a direction only when the line moves at least 3% a period **and** its whole rise or fall exceeds the residual standard deviation about it, so one odd week among four reads as flat. Flat carries no number, since one would argue with the arrow; it first showed the arrow alone, which looked out of place beside the others, so it reads `steady` in the unit's small muted style and every chip is about one size. The owner dropped the words Rising/Falling/Holding steady because the arrow says it; the unit is set small and muted with spaces (`9% / mo`) because `%/mo` read cramped. The unit is `day`, `wk`, `mo` (28–31 days) or the range's own length (`14d`).
- **Usual.** The earlier periods' average give or take their sample standard deviation, never narrower than 5% of the average: `Usually ₹5.9L–₹6.5L a month` under the headline, and `▲ usual`, `≈ usual` or `▼ usual` beside the direction.
- **Rows.** Each dish and category shows a bar per period, each from zero and scaled to that row's best period (the units bar already compares rows; a shared scale would flatten small dishes), in the chart legend's colours with the current period right, and its direction chip. Rising and Slow then mean heading up or down, fastest first, rather than beating the last period. The snapshot carries `periodUnits` per dish and category, at most four integers each, so Items reads every compared period (at least two).
- **Table.** Its last column becomes `vs usual`: the bucket against the earlier periods' same bucket, `▲ 14%`, `≈` or `▼ 13%`.

Falling chips, and the `vs last period` chips when down, use the danger tone, as the approved sketch did.

Rejected: words beside the arrow (long), a bare `9%` with the unit stated once above the list (the number then means a different thing at two periods and at four), a steadiness word in place of the usual range (the range is in rupees and checkable against the chart).

## The lists follow the measure; hours trim; presets group (owner, 2026-10-10)

After the first production release the owner found that choosing Revenue on Items changed only the chart: Dishes and Categories still showed and ranked units. They now follow the measure as everything on Sales does: with Revenue they show dish revenue in rupees and rank, bar, compare, chart per period and filter (Worst, Rising, Slow) on it; order share stays about orders. `sales_analytics` could not be edited in place once applied, so `20261013000000_items_follow_their_measure.sql` replaces it with the same signature, adding each dish's `previousRevenue` and every dish's and category's `periodRevenue` (at most four integers each).

Historical Hour charts and multi-day hour patterns show only the trading part of the day: from one hour before the first hour any compared period sold to one hour after the last, keeping quiet hours between; a day with no sales keeps all 24. Current one-day Hour trends retain the ongoing interval and unfinished tail as specified above. Their trend table uses the same span. This supersedes the earlier rule that main Hour totals keep all 24 hours.

The presets choose the grouping on both pages: 1d groups by Hour, 7d and 30d by Day. Choosing dates by hand leaves the grouping as it is.
