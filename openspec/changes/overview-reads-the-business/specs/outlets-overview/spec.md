## Purpose

Give owners and managers a compact, trustworthy view of their outlets' finances and source-page actions in both production and demo.

## ADDED Requirements

### Requirement: Every authorised outlet has a progressively loaded financial card

Overview SHALL show all authorised outlets without an outlet selector or business-health section. Each card SHALL contain a 2 by 2 grid of today's counter sales, current expected drawer cash, completed-period revenue and estimated operating P&L. Each metric SHALL replace its reserved shimmer as soon as its data arrives, independently of other metrics and outlets. Errors SHALL permit local retry without replacing successful figures or fabricating zeroes.

#### Scenario: Monthly revenue is slow

- **WHEN** today's sales arrive while revenue is pending
- **THEN** sales and their Cash/UPI split are visible while monthly cells retain their own shimmers

#### Scenario: Drawer explanation

- **WHEN** the drawer card loads
- **THEN** it shows expected cash now with Last Left from the last count and cash expenses since that count, without a collections or bills subtext

### Requirement: Monthly figures use completed business days

Revenue and estimated P&L SHALL use month start through yesterday's outlet business date, with counter and delivery using the same period and Ledger accounting basis. Comparison SHALL use the matching completed date range of the prior month, clamped to its last date. On the first business day, cards SHALL show the previous full month and compare against the preceding full month. Missing or provisional data SHALL be qualified; a zero or unavailable baseline SHALL NOT produce a growth percentage.

#### Scenario: First day of October

- **WHEN** the outlet business date is October 1
- **THEN** monthly cards show full September compared with full August, while today's sales and drawer remain current

#### Scenario: March following February

- **WHEN** the included current period ends March 30
- **THEN** the comparison ends on February's last date

### Requirement: Outlet status names tablet availability and links to its source

The one-minute heartbeat SHALL remain. A successfully activated, non-removed tablet heard from within three minutes SHALL count online. All expected tablets online SHALL show green Open; some SHALL show yellow Open; none SHALL show red Closed. Unknown status SHALL NOT claim Closed. No offline-tablet attention alert or visible online count SHALL be shown.

#### Scenario: Partial availability

- **WHEN** one of two activated tablets is online
- **THEN** the outlet shows yellow Open linked to that outlet's Tablets page

### Requirement: Metrics link to the displayed source scope

Today's sales SHALL link to that outlet's Billing page for today; Drawer SHALL link to its Drawer page; revenue and P&L SHALL link to its Ledger in the displayed month view. Demo SHALL use the same layout, calculations and source scope with no real-data writes. Database reads SHALL reject a manager requesting another outlet.

#### Scenario: Previous-month card

- **WHEN** a viewer taps September revenue on October 1
- **THEN** the Ledger opens that outlet in September month view, including on reload

### Requirement: Compact cards retain legible financial signals

Each metric SHALL have one subtext row on phone screens. Headline amounts SHALL use bold or extra-bold weight according to size, with bold metric headings and supporting numbers. Headline amounts SHALL omit paise by truncating only at the display edge; source pages SHALL retain exact paise. Six-digit rupee totals, including negative P&L, SHALL fit beside their icons without wrapping. Sales and Drawer SHALL use fixed neutral icons. Revenue SHALL use green/up for a positive comparable change and red/down for a negative change; zero or unavailable comparisons SHALL remain neutral. P&L SHALL use green/up for profit, red/down for loss and neutral for zero or unavailable profit. Shimmers SHALL reserve the matching compact layout.

#### Scenario: Large loss and falling revenue

- **WHEN** P&L is -₹9,99,999.99 and comparable revenue is below the previous period
- **THEN** Overview displays -₹9,99,999 with a red downward P&L icon and a red downward revenue icon, while tender icons remain neutral
