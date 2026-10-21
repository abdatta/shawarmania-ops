# Sales Analytics

## Purpose

An outlet's Items and Sales pages under Analytics, for owners and outlet managers:
which dishes sell and which lag, and whether sales improve over time, read on a phone
from settled bills in captured integer paise, against earlier equal-length
periods, through bounded database aggregates that keep Supabase egress low and refuse
any outlet the reader may not see.

## Requirements

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
On both pages the trend SHALL be one card with a Chart / Cumulative / Table switch kept in the address. The table SHALL hold every figure the chart draws: every bucket of every compared period, exact to the paisa, with the change against the previous period and a CSV export. Sales SHALL NOT show a separate Days list or a weekday-average card.

Cumulative SHALL draw the chart as running figures for every compared period, in the chart's own order: each point is the period's total from its first bucket through that one. On AOV each point SHALL be the weighted counter average so far, total counter revenue divided by total counter bills, never a sum or an average of averages. A bucket with nothing recorded SHALL add nothing; a bucket without bills SHALL hold the running AOV; a point an earlier period does not reach SHALL remain a gap. Ongoing and future points SHALL keep their markers and their **so far** and **not started** wording. The headline, caption, table and CSV SHALL remain per bucket, and switching SHALL reuse the loaded snapshot.

#### Scenario: Owner switches the Sales trend to a table
- **WHEN** the owner groups four 30-day periods by week and chooses Table
- **THEN** the table has one row per week the chart plots, one column per period plus Change, and reloading keeps the table

#### Scenario: Owner reads revenue as a running total
- **WHEN** the owner compares this week with last week by day on Revenue and chooses Cumulative
- **THEN** each period's line rises by each day's revenue, its last point equals that period's total in the table, inspecting a day shows every period's total up to that day, and reloading keeps Cumulative

#### Scenario: AOV accumulates bills, not averages
- **WHEN** a period has ₹300 across 2 bills on its first day, no bills on its second and ₹100 across 2 bills on its third, and the owner chooses Cumulative on AOV
- **THEN** the points read ₹150, ₹150 and ₹100

#### Scenario: Cumulative makes no read
- **WHEN** a loaded Items or Sales page switches between Chart, Cumulative and Table
- **THEN** no request is made and the headline and the table's figures are unchanged

### Requirement: Inclusive business dates and multiple comparisons
Sales SHALL offer 1d/7d/Month presets and Items 1d/7d/30d, each defaulting to 7d, with custom ranges. Month SHALL select the current month from its 1st through today. Sales SHALL support one through four total inclusive windows, actual short date-range legends and hour/day/week grouping. For 1d, 7d and custom ranges the windows SHALL be adjacent and of equal length; for Month they SHALL be the same day-of-month span in each earlier month, as defined by `business-figures`, and a whole month SHALL compare with whole months. Boundary groups SHALL include only selected days and align older periods by elapsed day.

Default and preset ranges SHALL include the current business date resolved through the selected outlet's cutover, spanning exactly 1, 7 or 30 inclusive dates, or the month to date. Explicit URL dates SHALL remain respected, and Month SHALL be kept in the address. With Month selected, previous- and next-period navigation SHALL step by calendar month and SHALL permit the current month; otherwise it SHALL step by the range's length and permit a range ending today. On each opening of Dates, editing the first endpoint SHALL shift the opposite endpoint to preserve the inclusive range length, including repeated edits of that first endpoint. Explicitly editing the opposite endpoint SHALL release the link for the rest of that opening. Apply SHALL commit only valid ordered ranges of 1–92 days within supported dates through today, and a range chosen by hand SHALL leave Month; cancel SHALL discard draft edits. Manual dates SHALL preserve grouping.

Comparison SHALL use a distinct compact icon pill and a total-period count, with Current only and 2/3/4-period choices labeled by actual ranges. When the current window ends today, every comparison figure (a change against an earlier period, an earlier period's total, a dish's or category's earlier units and revenue, and a fitted trend) SHALL use the earlier windows cut at the same time of day on their matched date, as defined by `business-figures`, computed by the server's clock. Chart points and table rows for earlier dates SHALL remain whole days, and an earlier period's cut total SHALL say up to what time it runs. Hour grouping SHALL use counter totals by Kolkata clock hour across each range, reusing the bounded period/hour payload. The 1d preset SHALL group by Hour, and 7d, 30d and Month by Day; dates chosen by hand SHALL keep the grouping. The bottom Hours graph SHALL use grouped columns, including preceding periods and accessible point inspection.

#### Scenario: Month in mid-October
- **WHEN** the owner chooses Month on 15 October and three preceding periods
- **THEN** Sales compares October 1–15 with September, August and July 1–15, labels those ranges, and preserves the choice on reload

#### Scenario: Step back from Month
- **WHEN** the owner, on Month in October, steps back once
- **THEN** the range is September 1–30, compared with the whole of August

#### Scenario: Month equals Overview
- **WHEN** the owner opens Month for an outlet whose Overview shows October revenue
- **THEN** the Revenue headline equals Overview's figure and its change equals Overview's change

#### Scenario: Today against yesterday at 15:40
- **WHEN** the owner chooses 1d at 15:40 with Revenue selected
- **THEN** the headline change compares today so far with yesterday up to 15:40, while yesterday's hourly points remain whole hours

#### Scenario: Change a seven-day range into eight days
- **WHEN** a range of October 4–10 has From changed to October 2, then To changed to October 9
- **THEN** To first moves to October 8, then From stays October 2 and the applied range spans eight days

#### Scenario: Before the outlet cutover
- **WHEN** the Kolkata calendar date is October 10 but the outlet's cutover has not occurred
- **THEN** 1d selects October 9, 7d selects October 3–9, and Month on Sales selects October 1–9

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
Hourly columns SHALL use solid theme-aware colors with rounded corners and gaps, without hatch patterns. A numbered legend and matching inspection markers SHALL identify the stable left-to-right series order. The lower hourly chart SHALL focus on hours with counter orders across all compared periods, retaining one adjacent hour on each side and intervening zero-sale hours. Empty data SHALL retain the full 24-hour axis. Historical main Hour trends and multi-day Hour aggregates SHALL trim to the same trading hours as their table. Current one-day Hour trends and their table SHALL use cutoff-aware business-day ordering and SHALL end one hour after the last hour any compared day sold in, or at the ongoing hour if that is later, rather than running on through closed hours to the cutoff; leading trimming SHALL preserve one neighboring hour before activity in any compared period. Current and comparison series SHALL share the axis. Pointer/touch/keyboard inspection and up to four comparisons SHALL remain available in both themes.

#### Scenario: Four periods on a phone
- **WHEN** the owner compares four periods with counter orders only between noon and 22:00
- **THEN** the lower chart shows 11:00 through 23:00, clearly spaced solid series with numbered actual-range legends and exact details, without additional reads

#### Scenario: Today's hourly chart ends after the last sale
- **WHEN** a current one-day Hour view is opened at 09:20 with the ongoing hour at 09:00, and yesterday's last sale was at 22:00
- **THEN** the axis ends at 23:00, the hours after it are not drawn, and today's ongoing hour keeps its hollow point

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

### Requirement: A comparison chart says what the earlier periods came to
Every trend that compares periods, on Sales and on Items, SHALL say beneath its headline what each earlier period came to, with its dates, and the time of day it runs to where it was cut: `vs ₹1,42,469 (3–9 Oct, until 8:58 am)`, or with several, `vs 448 (1–16 Sept) · 435 (1–16 Aug), each until 8:38 am`. With no earlier period it SHALL name the current period's dates. The headline's change, every dish's and category's change on Items, and the figures this line quotes SHALL use earlier windows cut at the same time of day where the current window ends today, as defined by `business-figures`. Descriptions of the measure (*Counter + delivery*, *Counter bills only*) and the Delivery coverage chip SHALL NOT appear in its place.

#### Scenario: Items at 9:20 in the morning
- **WHEN** the owner opens Items for the week ending today at 09:20
- **THEN** the headline compares this week with the previous one up to 09:20 on its last day, and the line reads `vs N (3–9 Oct, until 9:20 am)`

### Requirement: Axis labels fit without touching
A trend's date or hour axis SHALL draw as many labels as fit between the plot's edges without touching, evenly spaced, centred on their points and kept inside the chart's frame.

#### Scenario: A week of dates on a phone
- **WHEN** a seven-day trend is shown on a 375px phone
- **THEN** each date is drawn once, readable, with none running into its neighbour or past the chart's edge

### Requirement: Each page reopens on its last date shortcut
Items and Sales SHALL each remember, for the signed-in person on that browser and separately in demo mode, the last date shortcut (1d, 7d, 30d or Month) whose range was chosen there, and SHALL open on it whenever the address names no dates, counted from the outlet's current business date, with that shortcut's grouping. A choice on one page SHALL NOT change the other. Ranges chosen by hand or by stepping to an earlier period SHALL NOT change what is remembered. Where the remembered shortcut is not offered, its nearest one SHALL be used (Month for 30d, 30d for Month). With nothing remembered, or with storage unavailable, the page SHALL open on 7d. An address naming dates SHALL open on those dates.

#### Scenario: Items on a day, Sales on a week
- **WHEN** the owner taps 1d on Items, opens Sales, taps 7d there, and opens the app again the next day
- **THEN** Items opens on that business day grouped by hour, and Sales opens on the seven days ending that day grouped by day

#### Scenario: A hand-picked range is a one-off
- **WHEN** the owner, with 1d remembered on Sales, picks 3–9 Oct by hand and later reopens Sales
- **THEN** Sales opens on 1d

#### Scenario: Another person on the same phone
- **WHEN** a manager signs in on a phone where the owner remembered 30d on Items
- **THEN** Items opens on 7d for the manager

### Requirement: Each trend reopens as it was last read
Items and Sales SHALL each remember, the same way as the date shortcut, whether the person last read the trend as Chart, Cumulative or Table, and the card SHALL open on it whenever the address names no view. With nothing remembered the card SHALL open as Chart. A choice on one page SHALL NOT change the other, and an address naming a view SHALL open on it.

#### Scenario: Items as a table, Sales as a running total
- **WHEN** the owner chooses Table on Items and Cumulative on Sales, then reopens each page from the navigation
- **THEN** Items opens as the table and Sales as the running total
