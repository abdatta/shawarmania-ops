# Outlets Overview

## Purpose

Give owners and managers a compact, trustworthy view of their outlets' finances and source-page actions in both production and demo.

## Requirements

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

### Requirement: Outlet status names tablet availability and links to its source

The one-minute heartbeat SHALL remain. A successfully activated, non-removed tablet heard from within three minutes SHALL count online. All expected tablets online SHALL show Online with a green dot; some SHALL show Online with a yellow dot, and SHALL say to a screen reader that some tablets are offline; none SHALL show Offline with a red dot. Unknown status SHALL NOT claim Offline. No offline-tablet attention alert or visible online count SHALL be shown. The status SHALL link to that outlet's page on Outlets, where its tablets are.

The words Open and Closed SHALL NOT be used for this status: they name whether an outlet is trading, on Outlets, and a live reading of its tablets is a different fact.

#### Scenario: Partial availability

- **WHEN** one of two activated tablets is online
- **THEN** the outlet shows Online with a yellow dot, linked to that outlet's page on Outlets

#### Scenario: No tablet reachable

- **WHEN** none of an outlet's tablets has been heard from within three minutes
- **THEN** the outlet shows Offline with a red dot, and never Closed

### Requirement: Metrics link to the displayed source scope

Today's revenue SHALL link to that outlet's Billing history for today; Drawer SHALL link to its Drawer page; revenue and P&L SHALL link to its Ledger in the displayed month view. Demo SHALL use the same layout, calculations and source scope with no real-data writes. Database reads SHALL reject a manager requesting another outlet.

#### Scenario: Current-month card

- **WHEN** a viewer taps October revenue on October 15
- **THEN** the Ledger opens that outlet in October month view, including on reload

#### Scenario: Today's revenue

- **WHEN** a viewer taps today's revenue
- **THEN** Billing history opens that outlet on today

### Requirement: Compact cards retain legible financial signals

Each metric SHALL have one subtext row on phone screens, except today's revenue where its three tenders cannot fit one even as icons. Headline amounts SHALL use bold or extra-bold weight according to size, with bold metric headings and supporting numbers. Headline amounts SHALL omit paise by truncating only at the display edge; source pages SHALL retain exact paise. Six-digit rupee totals, including negative P&L, SHALL fit beside their icons without wrapping. Sales and Drawer SHALL use fixed neutral icons. Revenue SHALL use green/up for a positive comparable change and red/down for a negative change; zero comparisons and comparisons with an earlier period that had no sales SHALL remain neutral. P&L SHALL use green/up for profit, red/down for loss and neutral for zero or unavailable profit. Shimmers SHALL reserve the matching compact layout.

#### Scenario: Large loss and falling revenue

- **WHEN** P&L is -₹9,99,999.99 and comparable revenue is below the previous period
- **THEN** Overview displays -₹9,99,999 with a red downward P&L icon and a red downward revenue icon, while tender icons remain neutral

### Requirement: Outlet identity and status have breathing room

Each outlet card SHALL give its identity and linked Open/Closed status a distinct, comfortably padded header band with legible name and location text. The status loading shimmer SHALL reserve the loaded pill's enlarged footprint so arrival does not reflow the card.

#### Scenario: Compact phone card header

- **WHEN** Overview renders an outlet card on a phone
- **THEN** the outlet icon, two-line identity and status pill remain clearly separated without crowding the metric grid below

### Requirement: Initial outlet shimmers remember the browser's last successful shape

While the outlet list is pending, Overview SHALL reserve one outlet card when the browser has no valid prior count and otherwise SHALL reserve the last successfully loaded count browser-wide, irrespective of user, role or tab. A remembered zero SHALL still reserve one card. Failed reads SHALL NOT overwrite the remembered count. The successful adapter result SHALL replace the hint and SHALL remain the authority for which outlets are shown. The temporary shimmer count MAY be capped to protect the UI from corrupt or obsolete browser storage.

#### Scenario: A second tab opens after two outlets loaded

- **WHEN** Overview has successfully loaded two outlets in this browser and another tab opens Overview
- **THEN** the second tab initially reserves two outlet cards and then replaces them with its own authorised result

#### Scenario: First load has no hint

- **WHEN** Overview opens with no valid remembered count
- **THEN** it reserves one outlet card while the authorised outlet list is pending

#### Scenario: Outlet read fails

- **WHEN** a remembered count exists and the next outlet-list read fails
- **THEN** the existing count remains available for the next load rather than being replaced

### Requirement: Today's revenue names the sale in progress

Today's revenue SHALL show, beside its headline and after a separating dot, the total of the outlet's open, unpaid orders of its current
business date as the server resolves it, in integer paise summed by the server
and shown in exact rupees without compact notation, smaller than the headline
and in the size, weight and colour of the tender figures beneath. Where the cell
cannot hold both figures beside the tile's icon, the figure SHALL drop to half
the headline's size, and then the icon SHALL be left out, before either figure
is cut or wrapped. The figure SHALL carry
no label or icon of its own, SHALL be absent while the total is zero, and SHALL NOT be added
to revenue: paid orders still being prepared are already revenue and SHALL NOT be
counted in it, nor cancelled orders, nor open orders of an earlier business date.
It SHALL arrive in the same read as the tile's other figures, so the card makes
no further request.

#### Scenario: Orders are being made
- **WHEN** today's revenue is ₹35,630 and today has two open, unpaid orders of ₹840 and ₹400
- **THEN** the tile reads ₹35,630 · ₹1,240, the second figure smaller and muted, with no label

#### Scenario: A paid order is still cooking
- **WHEN** an order was paid ₹300 and is not yet prepared
- **THEN** its ₹300 is in today's revenue and not in the figure beside it

#### Scenario: Nothing is open
- **WHEN** today has no open, unpaid order
- **THEN** the tile shows its headline alone, with no dot and no ₹0

#### Scenario: A large amount in progress
- **WHEN** open orders come to ₹12,340
- **THEN** the figure reads ₹12,340, not ₹12.3k

### Requirement: The P&L tile leads with P&L (Pro-rata) where the month has fixed costs

Where an outlet has a fixed cost active in the current month, its Overview card's
P&L tile SHALL show P&L (Pro-rata) as its figure, titled *{Month} P&L (Pro-rata)*,
with its margin beside it, and beneath it a line of expenses, where expenses
include the unpaid share of fixed costs so that revenue less expenses is the
figure, and *Short* or *Ahead* (`profit-estimates`) until every fixed cost of the
month is paid. Each SHALL fit one line at a phone's width, in the tile's short
figures. Where it
has none, the tile SHALL read as it does without fixed costs. The tile's
placeholder SHALL reserve the shape of whichever form arrives.

The card SHALL make no more requests than it does without fixed costs: the
fixed-cost figures SHALL arrive with the month's existing read.

#### Scenario: An outlet with fixed costs

- **WHEN** the owner opens Overview on 18 October and Kalyani Cafe has fixed costs
- **THEN** the tile reads *October P&L (Pro-rata)*, the figure with its margin
  beside it, and *Expenses ₹6.6L · Short ₹1.3L*

#### Scenario: An outlet with none

- **WHEN** an outlet has no fixed cost this month
- **THEN** its tile is unchanged
