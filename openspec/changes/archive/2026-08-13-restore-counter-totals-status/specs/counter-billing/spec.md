## MODIFIED Requirements

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and optional
customer snapshot. It SHALL NOT show other shifts or another outlet.

The shared counter SHALL show aggregate Cash and UPI payment totals for its
current shift. The manager's Billing History Status view SHALL show the selected
outlet-day Cash and UPI totals before its sync activity. Both scopes SHALL use
the same total-card presentation.

The list SHALL include locally accepted payments immediately and SHALL use each
bill's latest effective allocation, including a durably accepted correction that
is still unsent. An eligible expanded bill SHALL carry its relative `Edit (N
min)` or `Edit (N sec)` action without making any other bill fact editable.

#### Scenario: Operator opens My shift

- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills appear and its Cash and UPI aggregates
  reflect only that shift

#### Scenario: Manager opens Status

- **WHEN** a manager opens the Billing History Status view for an outlet day
- **THEN** the outlet-day Cash and UPI payment aggregates appear before sync
  activity and do not alter the counter's current-shift scope

#### Scenario: A tender correction changes shift cash

- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed and both current-shift and outlet-day
  totals use its latest effective allocation
