## ADDED Requirements

### Requirement: The P&L tile leads with P&L (Pro-rata) where the month has fixed costs

Where an outlet has a fixed cost active in the current month, its Overview card's
P&L tile SHALL show P&L (Pro-rata) as its figure, titled *{Month} P&L (Pro-rata)*, and
beneath it the tile's usual line of expenses and margin, where expenses include
the unpaid share of fixed costs so that revenue less expenses is the figure. Where it
has none, the tile SHALL read as it does without fixed costs. The tile's
placeholder SHALL reserve the shape of whichever form arrives.

The card SHALL make no more requests than it does without fixed costs: the
fixed-cost figures SHALL arrive with the month's existing read.

#### Scenario: An outlet with fixed costs

- **WHEN** the owner opens Overview on 18 October and Kalyani Cafe has fixed costs
- **THEN** the tile reads *October P&L (Pro-rata)*, the figure, and *Expenses ₹6.6L*
  with its margin

#### Scenario: An outlet with none

- **WHEN** an outlet has no fixed cost this month
- **THEN** its tile is unchanged
