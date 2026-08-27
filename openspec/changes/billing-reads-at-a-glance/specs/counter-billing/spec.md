# Delta: counter-billing

## MODIFIED Requirements

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and
optional customer snapshot. It SHALL NOT show other shifts or another outlet.

The shared counter SHALL show aggregate Cash and UPI payment totals for its
current shift, in the two-column total cards. The manager's Billing History
SHALL show the selected outlet-day Cash and UPI totals, the day's combined
takings, and its average order value **outside its view tabs**: one row of four
cards below the day control and above the tab strip, on screen whichever view is
open, and SHALL NOT repeat them inside the Status view. That row SHALL hold a
silhouette of its own height until the outlet's day has resolved, so choosing a
view does not move under the reader. Its fourth card SHALL be labelled `AOV`.
Both scopes SHALL use the same total-card component, the manager's in its dense
four-column presentation.

Combined takings SHALL be the sum of the Cash and UPI figures shown beside it,
never a separately derived number, so that the cards always reconcile. The
average order value SHALL be those combined takings over the number of paid bills
in the same scope, in integer paise, and SHALL read as zero when that scope holds
no paid bill. Cancelled bills SHALL contribute to neither figure.

The list SHALL include locally accepted payments immediately and SHALL use each
bill's latest effective allocation, including a durably accepted correction that
is still unsent. An eligible expanded bill SHALL carry its relative `Edit (N
min)` or `Edit (N sec)` action without making any other bill fact editable.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills appear and its Cash and UPI aggregates
  reflect only that shift

#### Scenario: Manager opens Billing History
- **WHEN** a manager opens Billing History for an outlet day
- **THEN** the outlet-day Cash and UPI aggregates, combined takings and AOV are
  already on screen with the Bills list, and stay on screen when Open orders or
  Status is chosen, without altering the counter's current-shift scope

#### Scenario: Manager opens Status
- **WHEN** a manager opens the Billing History Status view for an outlet day
- **THEN** the view shows tablet sync activity alone, with the day's figures
  still readable above the tabs rather than repeated inside it

#### Scenario: A day with no paid bills has no average
- **WHEN** a manager opens Billing History for an outlet day on which nothing was paid
- **THEN** the AOV card reads zero rather than an undefined or infinite figure

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes shift cash
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed and both current-shift and outlet-day
  totals use its latest effective allocation
