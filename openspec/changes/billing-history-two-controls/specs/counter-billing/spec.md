# Delta: counter-billing

## MODIFIED Requirements

### Requirement: A manager reviews outlet history, voids, and clears stranded orders

A Franchise Admin SHALL review their outlets' paid bills and a Super Admin any
outlet. The surface SHALL ask two questions and no more — which outlet, and
which revenue business date — and SHALL NOT offer a bill-status or payment-method
filter. Every bill of the selected outlet-day SHALL be listed whatever its status
or tender, because each summary already names its own state and tender.

The outlet SHALL be chosen with the same shared, remembered outlet selector every
other outlet-scoped surface uses, in the page header. The date SHALL be chosen
with the same day control the manual ledger uses: a step to the previous day, a
step to the next, and the day itself opening the platform calendar. Forward
stepping SHALL stop at the selected outlet's current business date. The date
SHALL default to that outlet's current business date and render `Today`; a past
selected date SHALL render as a formatted business date. The visible date control
SHALL open the platform calendar and SHALL NOT present an empty browser date
placeholder. Neither control SHALL overflow horizontally at an ordinary phone
width.

Each bill SHALL have a scannable collapsed summary naming its bill number,
plain-language Paid or Cancelled state, total, tender, outlet-local time and
biller; a timestamp from today or yesterday SHALL use that relative calendar-day
label while retaining its absolute time. Selecting a summary SHALL expand that
bill directly beneath the summary, with at most one bill expanded at a time. The
expanded summary and detail SHALL use ordinary structural borders rather than an
accent-coloured expanded-state outline. Opening and closing detail SHALL use a
brief reduced-motion-aware height/opacity transition. When selection moves from
an earlier expanded bill to a lower bill, the surface SHALL keep the tapped lower
summary visually anchored during that transition.

Expanded detail SHALL structurally separate every immutable item snapshot with quantity,
unit price and line total; effective payment allocations and total; customer name and
phone including an explicit absence for either optional fact; order reference; ordered
and paid clocks; revenue business date; and payment business date when it differs.
Customer phone SHALL remain out of collapsed summaries, delivery diagnostics, logs and
exports. Order items and payment SHALL remain visible as distinct structured cards when a
bill opens. Customer details and Bill timeline SHALL each be a nested disclosure closed by
default, and SHALL reveal their facts in two columns when opened. Item names, values and
actions SHALL remain legible without horizontal scrolling.

An expanded paid bill SHALL initially show no cancellation-reason field. A manager SHALL
deliberately open `Cancel this bill` before the reason input, immutable-history consequence
and final confirmation appear. Confirmation SHALL perform the existing reasoned void
transition while the surface calls the result Cancelled. The corrected sale SHALL then be
manually rung as a new bill on the enrolled counter tablet; the manager surface SHALL
create no payment command, cross-device draft or automatic prefill. The manager SHALL see
any open order at that outlet and cancel it with a reason. Each open order SHALL show its
captured items, total, customer facts including explicit absence, creator and ordered time
before offering an exceptional cancellation action. The cancellation-reason input and final
confirmation SHALL remain hidden until the manager chooses `Cancel this order`.

#### Scenario: A manager opens a bill in place
- **WHEN** an authorised manager selects a collapsed bill in a long result list
- **THEN** that bill's structured detail appears immediately beneath its summary and any previously expanded bill closes

#### Scenario: A manager changes the selected bill
- **WHEN** a manager selects a lower bill while an earlier bill is expanded
- **THEN** the earlier detail visibly closes as the selected detail opens, no accent border is used merely because a bill is expanded, and the tapped summary does not abruptly jump away from its viewport position

#### Scenario: A bill has complete attribution
- **WHEN** an expanded bill carries customer name, customer phone, biller, item, tender and timing snapshots
- **THEN** biller attribution is readable in the summary, every remaining fact is readable in its named section, each item shows quantity, unit price and line total, and the phone is absent from the collapsed summary

#### Scenario: A bill has no customer snapshot
- **WHEN** either optional customer fact was not recorded
- **THEN** the corresponding detail reads Not provided rather than omitting the field or inventing a value

#### Scenario: Optional bill detail stays out of the way
- **WHEN** a manager first expands a bill at an ordinary phone width
- **THEN** order items and payment are visible, Customer details and Bill timeline are closed, and opening either nested disclosure presents its facts in two columns

#### Scenario: A recent bill is scanned
- **WHEN** a bill was paid today or yesterday in Asia/Kolkata
- **THEN** its summary reads Today or Yesterday with the absolute payment time

#### Scenario: Cancellation is exceptional
- **WHEN** an authorised manager first expands a paid bill
- **THEN** no cancellation reason is visible until they choose Cancel this bill, and final confirmation requires a non-blank reason

#### Scenario: A paid bill is corrected
- **WHEN** an authorised admin cancels a paid bill and an operator manually rings the corrected contents at the counter
- **THEN** the original stays unchanged with a user-facing Cancelled state and the replacement carries a new identity and number

#### Scenario: History is filtered by revenue date
- **WHEN** an order and its payment fall on different business dates
- **THEN** the bill is found under its order business date and detail separately names the later payment time and payment business date

#### Scenario: Cancelled bills are read alongside paid ones
- **WHEN** a manager opens an outlet-day on which bills were both paid and cancelled
- **THEN** every one of them is listed, each naming its own state, with no filter to operate and none needed to see either kind

#### Scenario: The surface asks the same two questions as its neighbours
- **WHEN** a manager opens Billing history at an ordinary phone width
- **THEN** the outlet is chosen from the shared header selector and the day from a bar with a step either side, both matching the surfaces that ask the same questions, and neither scrolls horizontally

#### Scenario: Billing history opens on the current business day
- **WHEN** a manager opens Billing history
- **THEN** the day control reads Today, the results are scoped to that outlet's current business date, stepping forward is refused, and choosing a past day makes the control read that formatted date

#### Scenario: An order is stranded on a tablet
- **WHEN** an order remains open at an outlet whose tablet is unavailable and the manager cancels it with a reason
- **THEN** the order is cancelled with that manager recorded, and nothing is transferred anywhere

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and
optional customer snapshot. It SHALL NOT show other shifts or another outlet.

The shared counter SHALL show aggregate Cash and UPI payment totals for its
current shift. The manager's Billing History Status view SHALL show the selected
outlet-day Cash and UPI totals before its sync activity, and beside them the
day's combined takings and its average bill. Every scope SHALL use the same
total-card presentation.

Combined takings SHALL be the sum of the Cash and UPI figures shown beside it,
never a separately derived number, so that the cards always reconcile. The
average bill SHALL be those combined takings over the number of paid bills in
the same scope, in integer paise, and SHALL read as zero when that scope holds no
paid bill. Cancelled bills SHALL contribute to neither figure.

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
  activity, with the day's combined takings and average bill beside them, and do
  not alter the counter's current-shift scope

#### Scenario: A day with no paid bills has no average
- **WHEN** a manager opens Status for an outlet day on which nothing was paid
- **THEN** the average bill reads zero rather than an undefined or infinite figure

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes shift cash
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed and both current-shift and outlet-day
  totals use its latest effective allocation
