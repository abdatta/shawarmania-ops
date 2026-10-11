## ADDED Requirements

### Requirement: Two outlet-scoped analytics pages
The application SHALL offer Items and Sales under Analytics as the fifth owner/manager navigation group, in live and demo through typed adapters. The database SHALL refuse staff, anonymous and foreign-outlet requests.

#### Scenario: Manager crafts a foreign-outlet request
- **WHEN** an assigned manager calls Analytics for another outlet
- **THEN** the database rejects the call regardless of browser controls

### Requirement: Honest captured sales
Analytics SHALL count settled bills only, preserve captured integer paise and explicit business dates, exclude voids and packaging from item units, distinguish item line revenue from bill totals, and include zero-sales dates and active unsold dishes.

#### Scenario: Menu prices change
- **WHEN** today's price changes or a bill is voided
- **THEN** retained settled snapshots determine historical sales and voids contribute nothing

### Requirement: Compact dish performance
Items SHALL offer All/Worst/Rising/Slow in one Dishes card, full names, search, selected-measure share, prior change, a Categories list with the selected measure, share and change against the previous period, and expandable figures/export. All sorts descending on the selected measure and Worst ascending including zeros. Rising/Slow require a nonzero preceding baseline. A fixed 320px internal region SHALL append batches without Show All or document growth, resetting on filter/search/date changes. Two-dish comparison, Ideas and Browsing SHALL be absent.

#### Scenario: Owner explores all dishes on a phone
- **WHEN** the owner scrolls the Dishes region and chooses Worst
- **THEN** all dishes remain reachable within the same card height, least sold first including zero sellers

### Requirement: Item and category trends
The measure SHALL govern the Dishes and Categories lists as well as the trend: with Revenue they show, rank, compare and filter on dish revenue. Items SHALL lead with a trend of Items sold or Dish revenue, grouped by Hour, Day (the default) or Week, for All dishes, one dish or one captured category, across one to four adjacent equal periods aligned by elapsed day. A picker and a tap on any dish or category row SHALL choose the subject, kept in the address. Dish figures SHALL be counter-only and say so.

#### Scenario: One day by hour
- **WHEN** the owner chooses 1d and groups Items by Hour
- **THEN** the chart shows the 24 Kolkata order hours of that day and of each compared day, without another read

#### Scenario: Owner charts a declining dish
- **WHEN** the owner taps a dish in Slow and compares four 30-day periods
- **THEN** the card charts that dish's units in each period with actual date labels, its headline equals the dish's units in the list, and a reload keeps the dish and the periods

### Requirement: Several periods read as a trend
With three or four compared periods, the trend headline, every dish and category row, and the table SHALL describe all of them rather than the change against the last one: a direction arrow with its fitted rate per period (`↗ 9% / mo`), `→ steady` when the movement is within the periods' own variation, the usual range of the earlier periods and the current period's place against it (`▲ usual`, `≈ usual`, `▼ usual`). Rows SHALL show one bar per period from zero, and Rising and Slow SHALL mean that direction. With two periods the change against the previous one SHALL remain.

#### Scenario: One odd week among four
- **WHEN** a dish sold 100, 160, 90 and 150 in four weeks
- **THEN** it shows `→ steady` without a number, four bars of exactly those heights, and appears in neither Rising nor Slow

### Requirement: One trend as a chart or a table
On both pages the trend SHALL be one card with a Chart / Table switch kept in the address. The table SHALL hold every figure the chart draws: every bucket of every compared period, exact to the paisa, with the change against the previous period and a CSV export. Sales SHALL NOT show a separate Days list or a weekday-average card.

#### Scenario: Owner switches the Sales trend to a table
- **WHEN** the owner groups four 30-day periods by week and chooses Table
- **THEN** the table has one row per week the chart plots, one column per period plus Change, and reloading keeps the table

### Requirement: Inclusive business dates and multiple comparisons
Both pages SHALL offer 1d/7d/30d presets, default 7d, and custom ranges. Sales SHALL support one through four total adjacent inclusive equal-length windows, actual short date-range legends and hour/day/week grouping. Boundary groups SHALL include only selected days and align older periods by elapsed day.

Default and preset ranges SHALL include the current business date resolved through the selected outlet's cutover, spanning exactly 1/7/30 inclusive dates. Explicit URL dates SHALL remain respected; next-period navigation SHALL permit a range ending today. On each opening of Dates, editing the first endpoint SHALL shift the opposite endpoint to preserve the inclusive range length, including repeated edits of that first endpoint. Explicitly editing the opposite endpoint SHALL release the link for the rest of that opening. Apply SHALL commit only valid ordered ranges of 1–92 days within supported dates through today; cancel SHALL discard draft edits. Manual dates SHALL preserve grouping.

Comparison SHALL use a distinct compact icon pill and a total-period count, with Current only and 2/3/4-period choices labeled by actual ranges. Hour grouping SHALL use counter totals by Kolkata clock hour across each range, reusing the bounded period/hour payload. The 1d preset SHALL group by Hour and 7d and 30d by Day on both pages; dates chosen by hand SHALL keep the grouping. The bottom Hours graph SHALL use grouped columns, including preceding periods and accessible point inspection.

#### Scenario: Four thirty-day windows
- **WHEN** the owner chooses 30d and three preceding periods
- **THEN** Sales compares four windows of exactly thirty days, labels actual ranges and preserves the choices on reload

#### Scenario: Change a seven-day range into eight days
- **WHEN** a range of October 4–10 has From changed to October 2, then To changed to October 9
- **THEN** To first moves to October 8, then From stays October 2 and the applied range spans eight days

#### Scenario: Before the outlet cutover
- **WHEN** the Kolkata calendar date is October 10 but the outlet's cutover has not occurred
- **THEN** 1d selects October 9 and 7d selects October 3–9

### Requirement: Items terminology and selected-measure shares
The Items page SHALL label sold quantities Items/Items sold rather than Units in controls, charts, explanations, accessibility text, tables and exports. Dishes SHALL show the selected measure's total rather than an order count. Each dish and captured category SHALL show its current-period share of all items sold when Items is selected, or of all dish revenue when Revenue is selected, using the same full outlet/range denominator. Search, filters and chart subject SHALL NOT change the denominator. Zero denominators SHALL show an em dash and zero sellers with a positive denominator SHALL show 0%. Revenue shares SHALL use captured line totals less line discounts, excluding delivery, packaging, bill-level discounts, tax and rounding. Order-share labels and the Items export's order-count column SHALL be absent.

#### Scenario: Search with Revenue selected
- **WHEN** a dish has 25 items and 13% of all dish revenue, and the owner selects Revenue and searches for it
- **THEN** its share reads 13% of revenue and remains unchanged by the search; categories use the same denominator

### Requirement: Clock-based incomplete intervals
Items and Sales line trends SHALL classify selected intervals using the current instant, Asia/Kolkata and the selected outlet's business-day cutover, independently of their numeric values. An interval SHALL be completed when its included end is at or before now, ongoing when its included start is at or before now and end is after now, or future when its included start is after now. Completed non-null points SHALL remain filled and connected, including zero. Ongoing nonzero points SHALL remain connected with a hollow dot. Ongoing zero/null and future points SHALL have no dot and no connecting segment; the line SHALL end at the previous plotted point, even when that completed point is zero. Null SHALL remain a gap rather than becoming zero.

One-day Hour intervals SHALL use their actual calendar placement within the explicit business date, including hours after midnight. Day intervals SHALL end at their outlet cutoff; Week intervals SHALL cover only selected business dates and remain ongoing when their selected final business day is ongoing. State SHALL update across time boundaries and foreground return without an added analytics read for classification. A clock-hour bucket straddling a fractional-hour cutoff SHALL retain its aggregate and remain unfinished until its last included segment closes, without inventing a split of its value. Earlier comparison periods SHALL preserve their own completed points. Repeated-clock-hour aggregates across several dates and lower hourly pattern columns SHALL retain their aggregate semantics rather than acquire a single hour's completion state.

Inspection and tables SHALL retain exact recorded figures and qualify ongoing values, including nonzero ones, as **so far**. Future intervals SHALL be identified as **not started**, rather than presented as a completed zero. CSV and totals SHALL preserve original numeric/null values. A seven-day range ending with an ongoing zero day SHALL have no point for that day; an entirely zero current window SHALL still preserve any completed zero intervals and SHALL NOT invent a point for an unfinished interval.

#### Scenario: Quiet hours after midnight are complete
- **WHEN** it is October 11 at 02:45 Kolkata, the outlet cutoff is 04:00, and business October 10's 00:00, 01:00, 02:00 and 03:00 hour values are zero
- **THEN** 00:00 and 01:00 remain completed filled zero points, 02:00 has no point or incoming segment and inspects as ongoing 0 so far, and 03:00 has no point or connection and is labeled not started

#### Scenario: The ongoing hour has sales
- **WHEN** 23:00–00:00 is ongoing and its recorded value is 2
- **THEN** it remains connected with a hollow dot and inspects as 2 so far, while future intervals have no current-series dot or connection

#### Scenario: A completed quiet hour follows sales
- **WHEN** hourly values are 10, 0, 20, 0, 0 and the first four intervals are completed while the fifth is ongoing
- **THEN** the fourth interval remains a filled zero connected to 20, the fifth has no dot or connection, and the line ends at the fourth interval rather than at 20

#### Scenario: The clock crosses an hour boundary
- **WHEN** an ongoing zero hour reaches its ending instant
- **THEN** that hour becomes a completed filled zero point, the new ongoing zero hour has no point, and classification adds no analytics RPC

#### Scenario: Before any sales today in a daily trend
- **WHEN** a seven-day range ends today and today's ongoing value is zero
- **THEN** the current line ends yesterday, earlier comparison points remain, and today's table value remains 0 so far

#### Scenario: A selected week is still developing
- **WHEN** a Week bucket contains completed selected days and today's ongoing business day with a nonzero total
- **THEN** its total remains exact, its current point is connected and hollow, and it becomes filled only when its final included business date closes at the outlet cutoff

### Requirement: Visible equal-size line markers
All eligible filled and hollow line markers SHALL remain visible without hover, touch or keyboard selection on Hour/Day/Week trends and all compared series. Hollow and filled dots SHALL have the same outer size, using the existing short-series marker size; an outline SHALL NOT enlarge the hollow marker. Inspection SHALL NOT control marker eligibility or make previously invisible points appear. Semantic tokens SHALL provide the hollow center and outline in both themes.

#### Scenario: Owner sees the chart without interacting
- **WHEN** the owner opens a one-day hourly chart with completed data and a nonzero ongoing point without hovering or tapping
- **THEN** every completed non-null point is visibly filled, the ongoing point is visibly hollow at the same outer size, and unfinished zero/future intervals have no point

#### Scenario: Inspect a hollow marker
- **WHEN** the owner hovers, taps or uses keyboard arrows on a nonzero ongoing point
- **THEN** its exact value and ongoing status are inspectable, with no change to its outer size relative to filled markers

### Requirement: Page-wide metrics and interactive charts
Revenue/Orders/AOV SHALL govern every Sales chart, the trend table and its export. Revenue uses counter plus recorded delivery gross before commission; provisional imports are disclosed and missing imports remain unknown. Orders and weighted AOV SHALL use counter bills only. Hour graphs SHALL use counter-only Kolkata ordered hours. Pointer hover, tap/click and keyboard point inspection SHALL expose the actual day/range/hour and exact metric for each selected period. AOV without orders SHALL be a gap and em dash, never zero or infinity.

#### Scenario: Inspect a point and change the measure
- **WHEN** the owner taps a point and switches to AOV
- **THEN** every chart uses counter revenue divided by counter orders for that bucket and missing orders remain explicit

### Requirement: Explicit pattern measures
The hourly pattern card SHALL name the chosen measure and aggregation. Hourly Revenue/Orders SHALL be per-day clock-hour averages over every selected date, including zero-sales dates. AOV SHALL remain weighted counter revenue/orders by hour, and missing AOV SHALL remain a gap. Main Hour grouping, its table and export SHALL retain counter totals.

#### Scenario: Two days with sales on only one
- **WHEN** a two-day range has ₹105 counter revenue and ten orders at noon on just one day
- **THEN** the lower hourly card reports ₹52.50 or five orders per day at noon, main Hour totals report ₹105 or ten orders, and hourly AOV remains ₹10.50

### Requirement: Clear solid comparison columns
Hourly columns SHALL use solid theme-aware colors with rounded corners and gaps, without hatch patterns. A numbered legend and matching inspection markers SHALL identify the stable left-to-right series order. The lower hourly chart SHALL focus on hours with counter orders across all compared periods, retaining one adjacent hour on each side and intervening zero-sale hours. Empty data SHALL retain the full 24-hour axis. Historical main Hour trends and multi-day Hour aggregates SHALL trim to the same trading hours as their table. Current one-day Hour trends and their table SHALL use cutoff-aware business-day ordering and retain the ongoing interval and unfinished tail even when zero; leading trimming SHALL preserve one neighboring hour before activity in any compared period. Current and comparison series SHALL share the axis. Pointer/touch/keyboard inspection and up to four comparisons SHALL remain available in both themes.

#### Scenario: Four periods on a phone
- **WHEN** the owner compares four periods with counter orders only between noon and 22:00
- **THEN** the lower chart shows 11:00 through 23:00, clearly spaced solid series with numbered actual-range legends and exact details, without additional reads

#### Scenario: Today's hourly tail crosses midnight
- **WHEN** a current one-day Hour view under a 04:00 cutoff is opened at 02:45 Kolkata with the last sale at 23:00
- **THEN** 00:00–03:00 follow 23:00 on the shared chart/table axis, completed midnight and 01:00 zeros remain plotted, and ongoing/future intervals remain visible on the axis without current-series dots

### Requirement: Bounded database aggregates and low egress
The client SHALL request one aggregate RPC per outlet/view/date/count change, with no raw bill/line records or identities. Metric, group and Chart/Table changes SHALL reuse the loaded snapshot. The Items chart SHALL read one subject's daily units and revenue as two arrays only when that subject is charted, never every dish's series at once, and SHALL not read a subject twice on one page. The database SHALL bound each window to 1–92 days and the count to 1–4. Items SHALL omit delivery/hours and collapse daily records into per-window summaries; Sales SHALL omit item/category payloads and skip bill-line reads. Hourly records SHALL be grouped by period/hour and bounded to 24 × count. No menu collector or telemetry schema SHALL be introduced.

#### Scenario: Change metric and grouping without egress
- **WHEN** a loaded Sales page changes Revenue to Orders/AOV, Day to Hour/Week, or Chart to Table
- **THEN** no additional analytics RPC occurs; increasing the period count requests only the chosen windows

### Requirement: Comparable bounded demo
Demo Analytics SHALL reconcile to shared captured bills, provide over three months of varied current/prior dish and timing data, and send no backend requests. The mature fixture SHALL remain bounded and preserve existing billing scenarios. The current demo business day SHALL visibly exercise in-progress analytics with shared partial-day bills and no future-dated sales. Deterministic review cases SHALL show both a nonzero ongoing interval with a hollow point and a zero ongoing interval with no point or connection. Every affected total, bill line, category, daily/hourly series and dependent demo surface SHALL stay consistent with the shared scenario; chart-only fabricated values and production-data imports SHALL be absent.

#### Scenario: Explore four thirty-day periods
- **WHEN** the owner selects every measure in the demo
- **THEN** meaningful current/previous figures, zero/rising/declining dishes and hour/weekday patterns are available without real-data writes

#### Scenario: Demo demonstrates a partial day consistently
- **WHEN** a deterministic demo clock is within a business day with settled bills in its ongoing hour
- **THEN** the current nonzero hourly/daily/selected-week points are hollow, future hours have no point, and bill, item, category, hour/day and dependent surface totals reconcile for each outlet

#### Scenario: Demo demonstrates an ongoing zero interval
- **WHEN** a deterministic demo clock is within an hour with no recorded sales and preceding completed hours exist
- **THEN** the line ends at the previous completed point, the ongoing hour has no filled or hollow point, completed zeros remain plotted, and table/CSV figures still reconcile to the shared bills
