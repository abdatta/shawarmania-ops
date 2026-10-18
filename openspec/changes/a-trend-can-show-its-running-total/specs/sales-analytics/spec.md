## MODIFIED Requirements

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
