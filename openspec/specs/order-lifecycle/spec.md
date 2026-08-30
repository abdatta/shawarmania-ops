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

An order SHALL carry `prepared_at`, a nullable timestamp set when the counter
marks it prepared and cleared when the counter reprepares it. Null SHALL mean
still preparing. Payment and preparation SHALL be independent axes: an order
MAY be paid while still preparing, and MAY be prepared while unpaid. The
status enum SHALL continue to describe only the money lifecycle.

Marking prepared SHALL be a typed command attributed like every other counter
command. Reprepare SHALL be refused once the order is paid — a prepared and
paid order is a bill, and bills do not return to preparation. Marking
prepared on a paid-but-unprepared order SHALL succeed and complete that
order's path to its bill.

#### Scenario: Order taken lands in preparing

- **WHEN** an operator saves a new order under a live shift
- **THEN** the order exists with null `prepared_at` and status open

#### Scenario: Marked prepared

- **WHEN** the owning tablet marks an open order prepared with its command time
- **THEN** `prepared_at` holds that time, the order remains open and unpaid until payment

#### Scenario: Reprepare while unpaid

- **WHEN** the owning tablet reprepares a prepared order whose status is open
- **THEN** `prepared_at` returns to null and the order remains fully editable

#### Scenario: Reprepare after payment

- **WHEN** any caller attempts to reprepare an order whose status is paid
- **THEN** the database refuses the command and no bill or order field changes

#### Scenario: Paid while still preparing

- **WHEN** an upfront payer's order is paid before being marked prepared
- **THEN** the order carries status paid with null `prepared_at`, and marking it prepared afterwards succeeds

#### Scenario: History paid before preparation existed

- **WHEN** an order was paid before the outlet recorded preparation at all
- **THEN** its stored payment moment stands as its preparation record — the row reads prepared at `paid_at` and appears among settled bills, never as pipeline work still owed
