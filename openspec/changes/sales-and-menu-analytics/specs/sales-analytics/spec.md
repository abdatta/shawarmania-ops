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
Items SHALL offer All/Worst/Rising/Slow in one Dishes card, full names, search, order share, prior change, two-dish comparison, category bars and expandable figures/export. All sorts descending units and Worst ascending including zeros. Rising/Slow require a nonzero preceding baseline. A fixed 320px internal region SHALL append batches without Show All or document growth, resetting on filter/search/date changes. Ideas and Browsing SHALL be absent.

#### Scenario: Owner explores all dishes on a phone
- **WHEN** the owner scrolls the Dishes region and chooses Worst or two dishes to compare
- **THEN** all dishes remain reachable within the same card height and chosen dishes share the same current/prior range

### Requirement: Completed dates and multiple comparisons
Both pages SHALL offer 1d/7d/30d presets, default 7d, and custom ranges. Sales SHALL support one through four total adjacent inclusive equal-length windows, actual short date-range legends and hour/day/week grouping. Boundary groups SHALL include only selected days and align older periods by elapsed day.

Comparison SHALL use a distinct compact icon pill and a total-period count, with Current only and 2/3/4-period choices labeled by actual ranges. Hour grouping SHALL use counter totals by Kolkata clock hour across each range, reusing the bounded period/hour payload. The bottom Hours graph SHALL use grouped columns, including preceding periods and accessible point inspection.

#### Scenario: Four thirty-day windows
- **WHEN** the owner chooses 30d and three preceding periods
- **THEN** Sales compares four windows of exactly thirty days, labels actual ranges and preserves the choices on reload

### Requirement: Page-wide metrics and interactive charts
Revenue/Orders/AOV SHALL govern all Sales charts, rows, table and export. Revenue uses counter plus recorded delivery gross before commission; provisional imports are disclosed and missing imports remain unknown. Orders and weighted AOV SHALL use counter bills only. Hour graphs SHALL use counter-only Kolkata ordered hours. Pointer hover, tap/click and keyboard point inspection SHALL expose the actual day/range/hour and exact metric for each selected period. AOV without orders SHALL be a gap and em dash, never zero or infinity.

#### Scenario: Inspect a point and change the measure
- **WHEN** the owner taps a point and switches to AOV
- **THEN** every chart uses counter revenue divided by counter orders for that bucket and missing orders remain explicit

### Requirement: Explicit pattern measures
Lower pattern cards SHALL name the chosen measure and aggregation. Weekday Revenue/Orders SHALL be daily averages by weekday; hourly Revenue/Orders SHALL be per-day clock-hour averages over every selected date, including zero-sales dates. AOV SHALL remain weighted counter revenue/orders by weekday or hour, and missing AOV SHALL remain a gap. Main Hour grouping, rows and export SHALL retain counter totals. This follow-up SHALL retain all existing charts.

#### Scenario: Two days with sales on only one
- **WHEN** a two-day range has ₹105 counter revenue and ten orders at noon on just one day
- **THEN** the lower hourly card reports ₹52.50 or five orders per day at noon, main Hour totals report ₹105 or ten orders, and hourly AOV remains ₹10.50

### Requirement: Clear solid comparison columns
Hourly columns SHALL use solid theme-aware colors with rounded corners and gaps, without hatch patterns. A numbered legend and matching inspection markers SHALL identify the stable left-to-right series order. The lower hourly chart SHALL focus on hours with counter orders across all compared periods, retaining one adjacent hour on each side and intervening zero-sale hours. Empty data SHALL retain the full 24-hour axis; main Hour totals/table SHALL retain all 24 hours. Pointer/touch/keyboard inspection and up to four comparisons SHALL remain available in both themes.

#### Scenario: Four periods on a phone
- **WHEN** the owner compares four periods with counter orders only between noon and 22:00
- **THEN** the lower chart shows 11:00 through 23:00, clearly spaced solid series with numbered actual-range legends and exact details, without additional reads

### Requirement: Bounded database aggregates and low egress
The client SHALL request one aggregate RPC per outlet/view/date/count change, with no raw bill/line records or identities. Metric/group changes SHALL reuse the loaded snapshot. The database SHALL bound each window to 1–92 days and the count to 1–4. Items SHALL omit delivery/hours and collapse daily records into per-window summaries; Sales SHALL omit item/category payloads and skip bill-line reads. Hourly records SHALL be grouped by period/hour and bounded to 24 × count. No menu collector or telemetry schema SHALL be introduced.

#### Scenario: Change metric and grouping without egress
- **WHEN** a loaded Sales page changes Revenue to Orders/AOV or Day to Hour/Week
- **THEN** no additional analytics RPC occurs; increasing the period count requests only the chosen windows

### Requirement: Comparable bounded demo
Demo Analytics SHALL reconcile to shared captured bills, provide over three months of varied current/prior dish and timing data, and send no backend requests. The mature fixture SHALL remain bounded and preserve existing billing scenarios.

#### Scenario: Explore four thirty-day periods
- **WHEN** the owner selects every measure in the demo
- **THEN** meaningful current/previous figures, zero/rising/declining dishes and hour/weekday patterns are available without real-data writes
