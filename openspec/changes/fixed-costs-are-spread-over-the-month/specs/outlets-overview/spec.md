## ADDED Requirements

### Requirement: The P&L tile leads with Pro-rata P&L where the month has fixed costs

Where an outlet has a fixed cost active in the current month, its Overview card's
P&L tile SHALL show Pro-rata P&L as its figure, titled with the month, and
beneath it how far through the month it is and P&L in compact notation. Where it
has none, the tile SHALL read as it does without fixed costs. The tile's
placeholder SHALL reserve the shape of whichever form arrives.

The card SHALL make no more requests than it does without fixed costs: the
fixed-cost figures SHALL arrive with the month's existing read.

#### Scenario: An outlet with fixed costs

- **WHEN** the owner opens Overview on 18 October and Kalyani Cafe has fixed costs
- **THEN** the tile reads *October Pro-rata P&L*, the figure, and *18 of 31 days ·
  P&L ₹1.89L*

#### Scenario: An outlet with none

- **WHEN** an outlet has no fixed cost this month
- **THEN** its tile is unchanged
