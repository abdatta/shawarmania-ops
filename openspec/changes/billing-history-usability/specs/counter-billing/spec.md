## MODIFIED Requirements

### Requirement: A manager reviews outlet history, voids, and clears stranded orders

A Franchise Admin SHALL review their outlets' paid bills and a Super Admin any
outlet, with revenue-business-date, status and payment filters. Each bill SHALL
have a scannable collapsed summary naming its bill number, plain-language Paid or
Cancelled state, total, tender, outlet-local time and biller; a timestamp from today or
yesterday SHALL use that relative calendar-day label while retaining its absolute
time. Selecting a summary SHALL expand that bill directly beneath the summary,
with at most one bill expanded at a time.
At an ordinary phone width, the four filters SHALL use two columns without horizontal
overflow; at wide widths they SHALL use one row of four controls.
The date filter SHALL default to the selected outlet's current business date and render
`Today`; a past selected date SHALL render as a formatted business date. The visible date
control SHALL open the platform calendar and SHALL NOT present an empty browser date placeholder.
The expanded summary and detail SHALL use ordinary structural borders rather than
an accent-coloured expanded-state outline. Opening and closing detail SHALL use a
brief reduced-motion-aware height/opacity transition. When selection moves from an
earlier expanded bill to a lower bill, the surface SHALL keep the tapped lower
summary visually anchored during that transition.

Expanded detail SHALL structurally separate every immutable item snapshot with
quantity, unit price and line total; effective payment allocations and total;
customer name and phone including an explicit absence for either optional fact;
order reference; ordered and paid clocks; revenue business
date; and payment business date when it differs. Customer phone SHALL remain out
of collapsed summaries, delivery diagnostics, logs and exports.
Order items and payment SHALL remain visible as distinct structured cards when a bill
opens. Customer details and Bill timeline SHALL each be a nested disclosure closed by
default, and SHALL reveal their facts in two columns when opened. Item names, values
and actions SHALL remain legible without horizontal scrolling.

An expanded paid bill SHALL initially show no cancellation-reason field. A
manager SHALL deliberately open `Cancel this bill` before the reason input,
immutable-history consequence and final confirmation appear. Confirmation SHALL
perform the existing reasoned void transition while the surface calls the result
Cancelled. The corrected sale SHALL then be manually rung as a new bill on the
enrolled counter tablet; the manager surface SHALL create no payment command,
cross-device draft or automatic prefill. The manager SHALL see any open order at
that outlet and cancel it with a reason. Each open order SHALL show its captured items,
total, customer facts including explicit absence, creator and ordered time before offering
an exceptional cancellation action. The cancellation-reason input and final confirmation
SHALL remain hidden until the manager chooses `Cancel this order`.

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

#### Scenario: Filters remain compact on a phone
- **WHEN** a manager opens Billing history at an ordinary phone width
- **THEN** the outlet, date, status and payment filters occupy two rows without horizontal scrolling

#### Scenario: Billing history opens on the current business day
- **WHEN** a manager opens Billing history
- **THEN** the date filter reads Today, the results are scoped to that outlet's current business date, and choosing a past day makes the control read that formatted date

#### Scenario: An order is stranded on a tablet
- **WHEN** an order remains open at an outlet whose tablet is unavailable and the manager cancels it with a reason
- **THEN** the order is cancelled with that manager recorded, and nothing is transferred anywhere

#### Scenario: A manager inspects an open order before cancelling
- **WHEN** a manager opens the Open orders view
- **THEN** each order's items, total, customer facts, creator and ordered time are readable, and no cancellation reason field is visible until they choose Cancel this order

### Requirement: Manager delivery diagnostics summarise sync health before technical evidence

The manager history surface SHALL call command transport evidence `Sync status`,
explain that it describes recent tablet activity reaching the server, and remain
read-only. It SHALL lead with whether any recent result needs attention, group
routine successful delivery by familiar business action and count, and SHALL NOT
render every accepted command as a separate default card. Individual short
references, command types, result categories and receipt times SHALL appear only
after the manager opens a technical-details disclosure. Payloads, command contents
and customer details SHALL remain unavailable.

#### Scenario: Routine activity all arrived
- **WHEN** recent diagnostics contain many accepted create, pay and cancel commands and no problem result
- **THEN** Sync status reports no recent sync problems and shows grouped action counts without a chronological card for every receipt

#### Scenario: A result needs attention
- **WHEN** a recent diagnostic has a non-success result
- **THEN** Sync status places a human-readable problem summary before successful activity and directs the manager to check the originating tablet

#### Scenario: Technical evidence is needed
- **WHEN** the manager opens Show technical details
- **THEN** short references, command types, result categories and receipt times become visible while payload and customer facts remain absent
