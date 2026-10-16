## RENAMED Requirements

- FROM: `### Requirement: Monthly figures use completed business days`
- TO: `### Requirement: Monthly figures run through today and always compare`

## MODIFIED Requirements

### Requirement: Every authorised outlet has a progressively loaded financial card

Overview SHALL show all authorised outlets without an outlet selector or business-health section. Each card SHALL contain a 2 by 2 grid of today's revenue, current expected drawer cash, the month's revenue to date and its estimated operating P&L. Today's revenue SHALL be cash, UPI and delivery imported for today, as defined by `business-figures`, with the three shown beneath it in the longest form that fits one line: words (*Cash · UPI · Delivery*), then delivery as a bike icon, then UPI as a QR code, then cash as a note, in that order; only where none fits, two lines in words, breaking between the counter's tenders and delivery. Each metric SHALL replace its reserved shimmer as soon as its data arrives, independently of other metrics and outlets. Errors SHALL permit local retry without replacing successful figures or fabricating zeroes.

#### Scenario: Monthly revenue is slow

- **WHEN** today's revenue arrives while the month is pending
- **THEN** today's revenue and its Cash, UPI and Delivery split are visible while monthly cells retain their own shimmers

#### Scenario: A phone and a wide screen

- **WHEN** today's revenue is ₹5,418 of cash ₹3,595, UPI ₹1,823 and delivery ₹0
- **THEN** a wide screen reads `Cash ₹3,595 · UPI ₹1,823 · Delivery ₹0` and a 375px phone the same with three icons, on one line

#### Scenario: Today's delivery has not arrived

- **WHEN** no delivery has been imported for today
- **THEN** today's revenue is cash plus UPI, Delivery reads ₹0, and no qualifier is shown

#### Scenario: Drawer explanation

- **WHEN** the drawer card loads
- **THEN** it shows expected cash now with Last Left from the last count and cash expenses since that count, without a collections or bills subtext

### Requirement: Monthly figures run through today and always compare

Revenue and estimated P&L SHALL cover the current month from its 1st through today's outlet business date, as defined by `business-figures`, including on the 1st. Expenses SHALL include delivery commission. Revenue SHALL always show its change against the same dates last month, cut at the same time of day; where the earlier dates have no sales it SHALL say so in words without a percentage. P&L SHALL show its margin whenever revenue is above zero. Overview SHALL NOT qualify either figure for missing delivery data or an unstated commission. The month, today and the cut SHALL be decided by the server's clock and the outlet's cutover.

#### Scenario: First day of October

- **WHEN** the outlet business date is October 1 at 13:00
- **THEN** the monthly cards show October so far, compared with September 1 up to 13:00

#### Scenario: Mid-month with sparse delivery

- **WHEN** an outlet's delivery channels have no record on ten of the month's dates
- **THEN** revenue includes whatever delivery was recorded, shows its change against the same dates last month, and says nothing about delivery coverage

#### Scenario: March following February

- **WHEN** the current period ends March 30
- **THEN** the comparison is the whole of February, uncut

### Requirement: Metrics link to the displayed source scope

Today's revenue SHALL link to that outlet's Ledger day view for today; Drawer SHALL link to its Drawer page; revenue and P&L SHALL link to its Ledger in the displayed month view. Demo SHALL use the same layout, calculations and source scope with no real-data writes. Database reads SHALL reject a manager requesting another outlet.

#### Scenario: Current-month card

- **WHEN** a viewer taps October revenue on October 15
- **THEN** the Ledger opens that outlet in October month view, including on reload

#### Scenario: Today's revenue

- **WHEN** a viewer taps today's revenue
- **THEN** the Ledger opens that outlet's day view for today, where cash, UPI and each delivery channel are broken down

### Requirement: Compact cards retain legible financial signals

Each metric SHALL have one subtext row on phone screens, except today's revenue where its three tenders cannot fit one even as icons. Headline amounts SHALL use bold or extra-bold weight according to size, with bold metric headings and supporting numbers. Headline amounts SHALL omit paise by truncating only at the display edge; source pages SHALL retain exact paise. Six-digit rupee totals, including negative P&L, SHALL fit beside their icons without wrapping. Sales and Drawer SHALL use fixed neutral icons. Revenue SHALL use green/up for a positive comparable change and red/down for a negative change; zero comparisons and comparisons with an earlier period that had no sales SHALL remain neutral. P&L SHALL use green/up for profit, red/down for loss and neutral for zero or unavailable profit. Shimmers SHALL reserve the matching compact layout.

#### Scenario: Large loss and falling revenue

- **WHEN** P&L is -₹9,99,999.99 and comparable revenue is below the previous period
- **THEN** Overview displays -₹9,99,999 with a red downward P&L icon and a red downward revenue icon, while tender icons remain neutral
