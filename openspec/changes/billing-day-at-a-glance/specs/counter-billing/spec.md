## MODIFIED Requirements

### Requirement: A manager reviews outlet history, voids, and clears stranded orders

A Franchise Admin SHALL review their outlets' paid bills and a Super Admin any
outlet. The surface SHALL ask two questions of the page — which outlet, and
which revenue business date. By default every bill of the selected outlet-day
SHALL be listed whatever its status or tender, newest payment first, because
each summary already names its own state and tender.

The Bills tab SHALL offer one Filter control opening a sheet that sorts and
narrows the listed bills of that outlet-day and nothing else. Sort SHALL be by
paid time, order time, amount, or wait (paid time less order time), each in
either direction named in the sort's own words (newest or oldest first, highest
or lowest first, longest or shortest first), ties broken by bill number in the
same direction. Filters SHALL be: Bill (Paid, Cancelled, Cancelled after paid,
Payment undone); Paid with (Cash, UPI, Split); Customer as a single choice (All,
With number, Without, Gold), where a bill carrying a name but no phone counts as
Without; Service (Dine-in, Takeaway); Only bills that (Had a discount, Payment
changed, Receipt failed); and Tablet, listing each billing tablet by name and
shown only on a day two or more tablets took bills. Choices within a group SHALL
widen the list and choices across groups SHALL narrow it; a group with no choice
SHALL not filter. The control SHALL name the choices in force and offer Clear
while any is chosen. The Bills tab SHALL read the shown and total counts while a
filter hides bills. The day's Cash, UPI, Total and AOV SHALL be unaffected by
any filter. Choices SHALL survive a change of day or outlet, SHALL be cleared on
leaving the page, SHALL NOT be written to browser storage, and SHALL cause no
read.

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
summary visually anchored during that transition, as far as the page has scroll
to give: anchoring is done by scrolling, so a swap near the top of a short list
SHALL let the summary rise by what is still owed rather than insert space above
the page, and SHALL leave it in view.

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
any open order at that outlet whose business date is the selected day, and no other, and
cancel it with a reason. The Open orders view SHALL name the unpaid total of the listed
orders — open, unpaid orders only, in integer paise — and its tab count SHALL be that
day's. Each open order SHALL show its
captured items, total, customer facts including explicit absence, creator and ordered time
before offering an exceptional cancellation action. The cancellation-reason input and final
confirmation SHALL remain hidden until the manager chooses `Cancel this order`.

#### Scenario: A manager opens a bill in place
- **WHEN** an authorised manager selects a collapsed bill in a long result list
- **THEN** that bill's structured detail appears immediately beneath its summary and any previously expanded bill closes

#### Scenario: A manager changes the selected bill
- **WHEN** a manager selects a lower bill while an earlier bill is expanded
- **THEN** the earlier detail visibly closes as the selected detail opens, no accent border is used merely because a bill is expanded, and the tapped summary does not abruptly jump away from its viewport position wherever the page has scroll left to hold it there

#### Scenario: A swap at the top of the page runs out of scroll
- **WHEN** the tapped summary sits above what the collapsing detail was tall, so holding it still would mean scrolling past the top of the page
- **THEN** it rises only by what could not be given back and stays in view, rather than the page inserting space above its header

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
- **THEN** every one of them is listed, each naming its own state, with no filter chosen and none needed to see either kind

#### Scenario: A manager finds the day's cancelled bills by size
- **WHEN** a manager chooses Cancelled and Cancelled after paid, sorted by Amount, highest first
- **THEN** only those bills are listed, largest first, the control reads what is chosen, the Bills tab reads the shown and total counts, and Cash, UPI, Total and AOV still read the whole day

#### Scenario: Customer choices cannot contradict
- **WHEN** a manager chooses Without under Customer
- **THEN** bills with no phone, including those carrying only a name, are listed, and Gold cannot be chosen at the same time

#### Scenario: A filter finds nothing
- **WHEN** the chosen filters match no bill of the day
- **THEN** the list reads No bills match with a Clear action, and Clear restores every bill in the default order

#### Scenario: A one-tablet day
- **WHEN** every bill of the day was taken on one billing tablet
- **THEN** the sheet offers no Tablet group

#### Scenario: Open orders follow the day
- **WHEN** a manager steps back to yesterday while today has open orders
- **THEN** Open orders lists only yesterday's orders still open, usually none, with that day's count and unpaid total

#### Scenario: The surface asks the same two questions as its neighbours
- **WHEN** a manager opens Billing history at an ordinary phone width
- **THEN** the outlet is chosen from the shared header selector and the day from a bar with a step either side, both matching the surfaces that ask the same questions, and neither scrolls horizontally

#### Scenario: Billing history opens on the current business day
- **WHEN** a manager opens Billing history
- **THEN** the day control reads Today, the results are scoped to that outlet's current business date, stepping forward is refused, and choosing a past day makes the control read that formatted date

#### Scenario: An order is stranded on a tablet
- **WHEN** an order remains open at an outlet whose tablet is unavailable and the manager cancels it with a reason
- **THEN** the order is cancelled with that manager recorded, and nothing is transferred anywhere

#### Scenario: A manager inspects an open order before cancelling
- **WHEN** a manager opens the Open orders view
- **THEN** each order's items, total, customer facts, creator and ordered time are readable, and no cancellation reason field is visible until they choose Cancel this order

## REMOVED Requirements

### Requirement: Manager delivery diagnostics summarise sync health before technical evidence

**Reason**: the owner never read the grouped counts of the last hundred commands
or the technical details (2026-10-16). Sync health moves into the Stats tab's
chip, which keeps the problems and their guidance; the day's figures replace the
grouped counts.

**Migration**: none. The diagnostics read is unchanged and still excludes
payloads and customer details.

## ADDED Requirements

### Requirement: The Stats tab reads the chosen day

Billing history's third tab SHALL be named Stats. It SHALL show, for the
selected outlet and business day and from one read, three groups stacked one
below the other, each a single card divided into a 2 × 2 grid with each number
above its caption: Counter (Placed, Updated, Cancelled, Paid), Kitchen (Seen,
Ready, Avg to ready, Avg handover) and Bills (Bills cancelled, Cancelled after
paid, Payment undone, Payment changed). Placed SHALL count the day's orders;
Updated those with at least one accepted revision, counted once per order;
Cancelled and Paid those in that state; Seen those a kitchen acknowledged; Ready
those with a live kitchen Ready mark. Avg to ready SHALL average the last live
Ready less the order time, and Avg handover the counter's Prepared mark less the
last live Ready, each over the orders it can be measured on, excluding orders the
day change finished; an average with nothing to average SHALL read as a dash.
The Bills figures SHALL count the day's bills cancelled by a manager (legacy
cancellations included), cancelled after payment at the counter, whose payment
the counter undid, and whose tender was corrected, each bill once. The groups
SHALL NOT be drawn as the tiles that carry the day's Cash, UPI, Total and AOV.

Above the groups a sync chip SHALL report the tablets' latest delivery,
independent of the selected day: in sync with the age of the newest received
command, or the number of sync problems with each problem listed beneath in
plain words, naming its order where the refusal named one and saying where a
resend cannot help. It SHALL show no technical-details disclosure, payload or
customer detail. The tab label SHALL carry the problem count in parentheses,
coloured as a warning, only while it is above zero.

The read SHALL answer the owner and that outlet's franchise admins and refuse
everyone else, including a manager's crafted request for another outlet.

#### Scenario: A busy day is counted whole
- **WHEN** a manager opens Stats on a day with more than a hundred tablet commands
- **THEN** every figure counts that whole day's orders and bills, matching a count of the day's rows

#### Scenario: A past day
- **WHEN** a manager steps the day bar back a week while Stats is open
- **THEN** the three groups read that day's figures and the sync chip still speaks for now

#### Scenario: An order goes to two kitchens
- **WHEN** one kitchen marks its part Ready at 12:04 and the other at 12:09, and the counter marks the order prepared at 12:11
- **THEN** the order counts once under Ready, its time to ready runs to 12:09, and its handover is two minutes

#### Scenario: Nothing to average
- **WHEN** no order of the day was marked Ready
- **THEN** Avg to ready and Avg handover read a dash, not zero

#### Scenario: A refusal waits
- **WHEN** a tablet command was refused
- **THEN** the tab reads Stats (1) with the count as a warning, and the chip names the problem and the order it concerned

#### Scenario: Another outlet is asked for
- **WHEN** a franchise admin requests the stats of an outlet they do not manage
- **THEN** the read is refused
