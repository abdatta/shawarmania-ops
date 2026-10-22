## ADDED Requirements

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
