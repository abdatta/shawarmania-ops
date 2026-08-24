## ADDED Requirements

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

## MODIFIED Requirements

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
