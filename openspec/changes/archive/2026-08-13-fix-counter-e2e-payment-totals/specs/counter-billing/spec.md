## MODIFIED Requirements

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and
optional customer snapshot. It SHALL NOT show other shifts, outlet-wide totals,
or another outlet.

The shared counter SHALL NOT show aggregate Cash or UPI payment totals. Those
outlet-day aggregates belong in the manager's deliberately opened Billing
History Totals view; the counter remains a bill activity surface.

The list SHALL include locally accepted payments immediately and SHALL use each
bill's latest effective allocation, including a durably accepted correction that
is still unsent. An eligible expanded bill SHALL carry its relative `Edit (N
min)` or `Edit (N sec)` action without making any other bill fact editable.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills appear, with no aggregate Cash or UPI totals

#### Scenario: Manager opens payment totals
- **WHEN** a manager opens the Billing History Totals view for an outlet day
- **THEN** the Cash and UPI payment aggregates appear there rather than on the shared counter

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes a bill
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed with its effective tender updated, without introducing aggregate payment totals to the shift rail

### Requirement: Live open-order actions stay on the tablet that took the order

Ordinary edit, payment and cancellation of an open order SHALL be available only
on the tablet that owns it, to any operator holding its live shift. Clearing an
order stranded on an unavailable tablet SHALL be an ordinary reasoned
cancellation by that outlet's manager, and no transfer or recovery path SHALL
exist. The card SHALL label its secondary number as Order #, show complete item
lines with line amounts, use relative age for today's order, and omit the creator
when the current shift holder created it. Its payment action SHALL read Mark Paid.
On the combined tablet workspace, edit SHALL hand the order to the full composer
and restore any suspended new-order draft after Save changes or Cancel edit.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred
