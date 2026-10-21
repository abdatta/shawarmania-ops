## MODIFIED Requirements

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

### Requirement: Clear solid comparison columns
Hourly columns SHALL use solid theme-aware colors with rounded corners and gaps, without hatch patterns. A numbered legend and matching inspection markers SHALL identify the stable left-to-right series order. The lower hourly chart SHALL focus on hours with counter orders across all compared periods, retaining one adjacent hour on each side and intervening zero-sale hours. Empty data SHALL retain the full 24-hour axis. Historical main Hour trends and multi-day Hour aggregates SHALL trim to the same trading hours as their table. Current one-day Hour trends and their table SHALL use cutoff-aware business-day ordering and SHALL end one hour after the last hour any compared day sold in, or at the ongoing hour if that is later, rather than running on through closed hours to the cutoff; leading trimming SHALL preserve one neighboring hour before activity in any compared period. Current and comparison series SHALL share the axis. Pointer/touch/keyboard inspection and up to four comparisons SHALL remain available in both themes.

#### Scenario: Four periods on a phone
- **WHEN** the owner compares four periods with counter orders only between noon and 22:00
- **THEN** the lower chart shows 11:00 through 23:00, clearly spaced solid series with numbered actual-range legends and exact details, without additional reads

#### Scenario: Today's hourly chart ends after the last sale
- **WHEN** a current one-day Hour view is opened at 09:20 with the ongoing hour at 09:00, and yesterday's last sale was at 22:00
- **THEN** the axis ends at 23:00, the hours after it are not drawn, and today's ongoing hour keeps its hollow point

## ADDED Requirements

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
