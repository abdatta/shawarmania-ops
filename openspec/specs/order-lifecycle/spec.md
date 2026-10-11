# Order Lifecycle

## Purpose

Defines editable counter orders, their daily customer-facing numbers, ownership,
terminal states, attributed cancellation, and their role in business-day close.

## Requirements

### Requirement: An unpaid order is editable until it is paid or cancelled

An unpaid order SHALL carry a client UUID, outlet, owning tablet, creator,
shift, order time, explicit business date, customer form snapshot, lines,
integer-paise totals, and nullable `prepared_at`. Only an `open` order SHALL
accept revision or preparation commands. Payment or cancellation SHALL make it
immutable; preparation state is part of that immutability and SHALL NOT change
on a paid or cancelled order except by the paid-order unwind commands this
specification names separately.

#### Scenario: Order is revised

- **WHEN** its owning tablet revises an open order under a live shift
- **THEN** every validated change commits atomically and `prepared_at` is unchanged by revision

#### Scenario: Paid order is edited

- **WHEN** any caller attempts to revise an order already marked paid
- **THEN** the database refuses the transition

### Requirement: An order carries a daily order number that is never a bill number

Every order SHALL receive a small sequential number allocated per outlet **per
business day**, restarting each business day, in the same transaction that
creates the order. It SHALL be the number the customer is called by, SHALL be
resolved against the outlet cutover rather than the calendar date, and SHALL
neither consume nor resemble a bill number.

#### Scenario: Numbers restart each business day

- **WHEN** the first order of a new business day is created at an outlet
- **THEN** its order number restarts the daily sequence for that outlet

#### Scenario: An order taken before cutover

- **WHEN** an order is created at 03:55 at an outlet whose cutover is 04:00
- **THEN** it takes the previous business day's date and the next number in that day's sequence

#### Scenario: A cancelled order consumes no bill number

- **WHEN** an order is cancelled and a later order is paid
- **THEN** the paid bill's number is the next in the outlet's permanent sequence with no gap

#### Scenario: A pay-now sale has no order number

- **WHEN** a sale is rung and paid without an order being recorded
- **THEN** a bill exists with a bill number and no order number is allocated

### Requirement: Ordinary order actions stay on the owning tablet

Create SHALL bind the order to the tablet that made it. Ordinary revise, pay and
cancel commands SHALL require that same tablet, though any eligible operator
holding its live shift may act. The creator and each later actor SHALL remain
separately attributable.

#### Scenario: Another operator uses the same tablet

- **WHEN** an incoming operator holding the new shift revises the open order on that tablet
- **THEN** the revision succeeds with that actor recorded and the creator unchanged

#### Scenario: Another tablet attempts payment

- **WHEN** a different tablet hand-crafts a pay command for the order
- **THEN** the database refuses it even if that tablet belongs to the same outlet

### Requirement: An order that is no longer open refuses every further command

Revise, pay, cancel, mark-prepared and reprepare SHALL lock the order row and
require its status to be `open`, except that marking prepared on a paid but
unprepared order is accepted as its completion path, and the paid-order unwind
commands follow their own guards. A command against an order already paid or
cancelled SHALL be refused with a category naming that state, and SHALL change
no order, line, bill or bill number.

#### Scenario: A manager cancels while the counter is paying

- **WHEN** a pay command locks an order that was cancelled moments earlier
- **THEN** the payment is refused as not open, no bill is created, and no bill number is consumed

#### Scenario: Preparation on a cancelled order

- **WHEN** a mark-prepared or reprepare command arrives for a cancelled order
- **THEN** the database refuses it with the not-open category and changes nothing

### Requirement: Cancellation is attributed and leaves history

An open order SHALL be cancellable in full with a non-blank reason. Cancellation
SHALL record actor, tablet where applicable, shift, time and reason. No client
role SHALL hard-delete an order or its lines.

#### Scenario: Operator cancels at the counter

- **WHEN** an operator holding the live shift cancels with a reason
- **THEN** the order becomes immutable cancelled history and no bill number is consumed

### Requirement: An outlet's manager can cancel any open order at that outlet

That outlet's Franchise Admin, and any Super Admin, SHALL be able to cancel an
open order at that outlet with a non-blank reason, from their own device, without
holding a shift and whatever the state of the tablet that created it.

#### Scenario: An order stranded on a removed tablet

- **WHEN** a tablet is removed while one of its orders is still open, and the outlet's FA cancels that order with a reason
- **THEN** the order becomes cancelled history attributed to that manager, and the date is no longer blocked by it

#### Scenario: Another outlet's manager

- **WHEN** an FA hand-crafts a cancellation for an open order at an outlet they do not manage
- **THEN** the database refuses it

### Requirement: Open orders block business-day sign-off

An outlet business date SHALL NOT be settlement-ready while any order carrying
that business date remains open. Paying or cancelling every such order SHALL
remove that blocker without changing the order's business date.

#### Scenario: An unpaid order remains at close

- **WHEN** readiness is evaluated for a date with an open order
- **THEN** it reports that order as a blocker and no day-sign-off transaction may succeed

### Requirement: An order carries a preparation state independent of payment

An order SHALL carry `prepared_at`, a nullable timestamp, and `prepared_source`,
which is `counter` or `day_change` and is null exactly when `prepared_at` is null.
Null SHALL mean still preparing. Payment and preparation SHALL be independent axes:
an order MAY be paid while still preparing, and MAY be prepared while unpaid. The
status enum SHALL continue to describe only the money lifecycle.

Marking prepared by the counter SHALL be a typed command attributed like every
other counter command, and SHALL record `prepared_source = counter`. Reprepare
SHALL be refused once the order is paid — a prepared and paid order is a bill, and
bills do not return to preparation. Marking prepared on a paid-but-unprepared order
SHALL succeed and complete that order's path to its bill.

No client role SHALL be able to set or clear `prepared_source` other than through
the counter's prepare, reprepare and payment-unwind commands.

#### Scenario: Order taken lands in preparing

- **WHEN** an operator saves a new order under a live shift
- **THEN** the order exists with null `prepared_at`, null `prepared_source` and status open

#### Scenario: Marked prepared

- **WHEN** the owning tablet marks an open order prepared with its command time
- **THEN** `prepared_at` holds that time, `prepared_source` is `counter`, and the order remains open and unpaid until payment

#### Scenario: Reprepare while unpaid

- **WHEN** the owning tablet reprepares a prepared order whose status is open
- **THEN** `prepared_at` and `prepared_source` return to null and the order remains fully editable

#### Scenario: Reprepare after payment

- **WHEN** any caller attempts to reprepare an order whose status is paid
- **THEN** the database refuses the command and no bill or order field changes

#### Scenario: Paid while still preparing

- **WHEN** an upfront payer's order is paid before being marked prepared
- **THEN** the order carries status paid with null `prepared_at`, and marking it prepared afterwards succeeds

#### Scenario: History paid before preparation existed

- **WHEN** an order was paid before the outlet recorded preparation at all
- **THEN** its stored payment moment stands as its preparation record — the row reads prepared at `paid_at` and appears among settled bills, never as pipeline work still owed

#### Scenario: A client writes the source by hand

- **WHEN** an authenticated person, a Franchise Admin or a counter tablet hand-crafts an update setting `prepared_source` on an order
- **THEN** the database refuses it and the order is unchanged

### Requirement: An order records how it was served, and may be called by its table

An order SHALL record whether it was dine-in, takeaway or neither, and a dine-in
order MAY record a table number. A bill SHALL copy both from its order, or take
them from a direct sale's own payload. Both SHALL be snapshots. No later change
to the outlet's choices SHALL alter them. Both MAY change while the order is open
and SHALL be fixed at payment.

Where an order has a table, the counter SHALL show its order number followed by
its table, as `#106  TABLE 8`. An order with a table SHALL show its table even
while its number has not yet arrived.
Where an order has a type and no table, its pipeline card SHALL say whether it is
dine-in or takeaway, so the kitchen can tell a plate from a parcel.
The order number SHALL still be allocated and
stored, and SHALL remain what history, voids and manager surfaces identify the
order by.

#### Scenario: The number leads and the table follows it

- **WHEN** order 106 for table 8 is on the pipeline
- **THEN** its card reads #106 followed by Table 8

#### Scenario: A parcel with no table

- **WHEN** a takeaway order is on the pipeline
- **THEN** its card says Takeaway beside its number, in the same tag a table wears

#### Scenario: The outlet stops offering dine-in

- **WHEN** the owner turns dine-in off after dine-in orders were paid
- **THEN** those bills still record dine-in and their tables

#### Scenario: A paid order is re-marked

- **WHEN** any caller attempts to change the type or table of a paid order
- **THEN** the database refuses it

### Requirement: An order records that it shared its table

Whenever a write leaves two or more open orders at one outlet on the same table,
each of those orders SHALL be marked as having shared its table, by the server,
in the same transaction as the write. The mark SHALL never be removed, including
by payment or cancellation, and SHALL never cause a write to be refused.

#### Scenario: A payment taken back after the table was seated again

- **WHEN** a paid table-4 order is reopened by taking its payment back while another order is open at table 4
- **THEN** both orders are marked as having shared their table, and stay marked after either is paid

#### Scenario: The same number at another outlet

- **WHEN** table 4 is open at two different outlets
- **THEN** neither order is marked

### Requirement: The day change finishes a paid order nobody marked prepared

A paid order is eventually served: the owner's rule is not that it has been served
when the day is closed, but that it has been by the time the shop has shut. The
outlet's business-day cutover is the first instant that is reliably true.

When the business day that an order's **payment** belongs to has ended — at
`payment_business_date + 1` at the outlet's cutover — an order whose status is
`paid` and whose `prepared_at` is null SHALL be marked prepared with `prepared_at`
equal to **that cutover instant** and `prepared_source = day_change`.

The recorded values SHALL depend only on stored facts, so that the same rows result
whenever the finishing runs after the cutover. An order whose status is `open` or
`cancelled` SHALL NOT be touched. No `billing_commands` receipt SHALL be written,
and no tablet's end-of-day confirmation SHALL be invalidated by it.

The function that performs it SHALL be executable by no client role.

#### Scenario: A forgotten tick at night

- **WHEN** an order is paid at 22:05 on business date D and nobody ticks Prepared
- **THEN** after the cutover ending D it reads prepared at that cutover with source `day_change`, and it is on no rail

#### Scenario: Paid after midnight, before the cutover

- **WHEN** an order is taken at 03:55 on business date D and paid at 04:05, falling on payment business date D+1
- **THEN** it is finished at the cutover ending D+1, never at the one ending D, and its `prepared_at` is never earlier than its payment

#### Scenario: Finishing runs late

- **WHEN** the finishing first runs three hours after the cutover
- **THEN** the order's `prepared_at` is the cutover instant, identical to a run on the minute

#### Scenario: An unpaid order crosses the cutover

- **WHEN** an open, unpaid order is still on the rail after the cutover
- **THEN** it is unchanged and remains on the rail

#### Scenario: A client calls the finishing directly

- **WHEN** an authenticated person, a Franchise Admin, a Super Admin or a counter tablet hand-crafts a call to the finishing function
- **THEN** the database refuses it

#### Scenario: Counting the day change's work

- **WHEN** an operator queries orders whose `prepared_source` is `day_change`, grouped by outlet and payment business date
- **THEN** each such order is counted exactly once, and no order a counter ticked is among them

### Requirement: A late counter tick supersedes the day change, and an unwind clears it

A Prepared command for an order whose `prepared_source` is `day_change` SHALL be
accepted. Where its command time is earlier than the recorded `prepared_at`, the
order SHALL take the command time and `prepared_source = counter`; otherwise the
command SHALL be accepted without changing the order. A Prepared command for a paid
order whose `prepared_source` is `counter` SHALL continue to be refused as not open.

A payment take-back accepted for an order whose `prepared_source` is `day_change`
SHALL return its `prepared_at` and `prepared_source` to null, because the stamp was
premised on the payment the take-back removes. A counter-sourced preparation SHALL
survive a take-back as it does today.

#### Scenario: A tick queued offline before the cutover

- **WHEN** a tablet ticks Prepared at 23:40 with no network and delivers the command after the day change has finished that order
- **THEN** the command is accepted, the order reads prepared at 23:40 with source `counter`, and the tablet holds no needs-attention item for it

#### Scenario: A take-back queued offline before the cutover

- **WHEN** a take-back created inside the edit window under the shift then live is delivered after the day change finished the order
- **THEN** the order returns to open with null `prepared_at` and null `prepared_source`

#### Scenario: A second tick on an order the counter already ticked

- **WHEN** a Prepared command arrives for a paid order whose `prepared_source` is `counter`
- **THEN** it is refused as not open and nothing changes

### Requirement: A kitchen reads unfinished orders without customer, price or payment facts

An outlet's unfinished orders SHALL be readable by a live kitchen shift at that
outlet only through the kitchen board, which SHALL return for each order its
identity, order number, service, table, ordered time, last-changed time, status and
cancelled time, its item lines visible under the tablet's filter (name, quantity
and menu item), the count of its other item lines, and that tablet's own
acknowledgements. It SHALL return no packaging line, no amount of any kind, and no
customer name, phone, identity or tier. A kitchen shift SHALL hold no select
privilege on orders, order lines, order discounts, bills or bill lines.

Every order write SHALL notify its outlet's kitchens that something changed, without
carrying order data.

#### Scenario: A hand-crafted read of the customer

- **WHEN** a kitchen tablet with a live kitchen shift hand-crafts a select of `orders` for its outlet, or of any order's customer columns
- **THEN** the database returns nothing it may not see and refuses the read

#### Scenario: The board carries no money

- **WHEN** the kitchen board is read for an order with a discount and a packaging line
- **THEN** the response carries neither the discount, any amount, nor the packaging line

#### Scenario: Another outlet's board

- **WHEN** a kitchen tablet hand-crafts a board read naming another outlet
- **THEN** it receives only its own shift's outlet, and no row of the other
