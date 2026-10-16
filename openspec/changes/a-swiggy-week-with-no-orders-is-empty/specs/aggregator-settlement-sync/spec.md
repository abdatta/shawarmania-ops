## ADDED Requirements

### Requirement: An open week with no orders yet is empty, not a shortfall

An aggregator's open payout period that has no dates because it has no orders yet SHALL be read as an empty week. The run SHALL NOT report it as a shortfall, SHALL NOT invent a window for it, and SHALL record nothing for it.

A period SHALL count as empty only when the aggregator itself states that it holds no orders. An undated open period that states orders, or states no count, SHALL still be reported as a shortfall, because its orders have no window to be read in. The reported reason SHALL say how many orders the aggregator stated, so the two cases can be told apart from the run history alone.

#### Scenario: A week with no Swiggy order reads clean

- **WHEN** a Swiggy read finds the current payout period undated, with an order count of zero, and every settled week behind it reads and reconciles
- **THEN** the run is recorded as `ok`, no open cycle is posted, and the owner's surface does not report the channel as stuck

#### Scenario: Orders without a window are still a shortfall

- **WHEN** a Swiggy read finds the current payout period undated while it states orders, or states no order count
- **THEN** the run is recorded as a shortfall that names the stated count, and the settled weeks behind it are still written
