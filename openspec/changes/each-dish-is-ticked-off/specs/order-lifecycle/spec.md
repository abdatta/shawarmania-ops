## MODIFIED Requirements

### Requirement: An order carries a preparation state independent of payment

An order SHALL carry `prepared_at`, a nullable timestamp, and `prepared_source`,
which is `counter` or `day_change` and is null exactly when `prepared_at` is null.
Null SHALL mean still preparing. Payment and preparation SHALL be independent axes:
an order MAY be paid while still preparing, and MAY be prepared while unpaid. The
status enum SHALL continue to describe only the money lifecycle.

**The counter prepares an order dish by dish.** Ticking and unticking item lines
SHALL be a typed counter command, idempotent by its client identity and attributed
like every other counter command, issued only by the owning tablet. A line SHALL be
ticked while the quantity recorded by its tick is at least its current quantity.
When every item line of the order is ticked, the command SHALL set `prepared_at` to
its command time and `prepared_source = counter`; when an item line is not, it SHALL
clear both on an open order. A revision that leaves an item line unticked SHALL clear
an open order's counter-set preparation. The whole-order Prepared command SHALL remain
accepted, ticking or unticking every item line.

Reprepare SHALL be refused once the order is paid and prepared — a prepared and paid
order is a bill, and bills do not return to preparation; no dish of such an order
SHALL be unticked. Ticking the last dish of a paid-but-unprepared order SHALL succeed
and complete that order's path to its bill.

No client role SHALL be able to set or clear `prepared_source`, or write a dish's
tick, other than through the counter's dish, prepare, reprepare and payment-unwind
commands.

#### Scenario: Order taken lands in preparing

- **WHEN** an operator saves a new order under a live shift
- **THEN** the order exists with null `prepared_at`, null `prepared_source`, no dish ticked and status open

#### Scenario: The last dish is ticked

- **WHEN** the owning tablet ticks the last unticked item line of an open order
- **THEN** `prepared_at` holds that command's time, `prepared_source` is `counter`, and the order remains open and unpaid until payment

#### Scenario: A dish is unticked while unpaid

- **WHEN** the owning tablet unticks a dish of a prepared order whose status is open
- **THEN** `prepared_at` and `prepared_source` return to null and the order remains fully editable

#### Scenario: Food added to a prepared order

- **WHEN** a prepared open order is revised to add a line
- **THEN** the new line is unticked and the order's `prepared_at` and `prepared_source` return to null

#### Scenario: Reprepare after payment

- **WHEN** any caller attempts to untick a dish of, or reprepare, an order whose status is paid and which is prepared
- **THEN** the database refuses the command and no bill, order or dish field changes

#### Scenario: Paid while still preparing

- **WHEN** an upfront payer's order is paid before its dishes are ticked
- **THEN** the order carries status paid with null `prepared_at`, and ticking its dishes afterwards succeeds and prepares it with the last tick

#### Scenario: A tablet's queued whole-order tick

- **WHEN** a tablet delivers a whole-order Prepared command queued before this change
- **THEN** every item line is ticked and the order is prepared as before

#### Scenario: History paid before preparation existed

- **WHEN** an order was paid before the outlet recorded preparation at all
- **THEN** its stored payment moment stands as its preparation record — the row reads prepared at `paid_at` and appears among settled bills, never as pipeline work still owed

#### Scenario: A client writes the source by hand

- **WHEN** an authenticated person, a Franchise Admin or a counter tablet hand-crafts an update setting `prepared_source` on an order, or a write to a dish's tick
- **THEN** the database refuses it and nothing changes

### Requirement: A kitchen reads unfinished orders without customer, price or payment facts

An outlet's unfinished orders SHALL be readable by a live kitchen shift at that
outlet only through the kitchen board, which SHALL return for each order its
identity, order number, service, table, ordered time, last-changed time,
status and cancelled time, its item lines visible under the tablet's filter (name,
quantity, owed quantity, note and menu item), the count of its other item lines,
this tablet's ticket number for the order, and that tablet's own acknowledgements
and Readies. Its read SHALL support separate cooking tickets for newly owed food
and distinct Done receipts containing captured food not yet handed over. It SHALL
return no packaging line, no amount of any kind, and no
customer name, phone, identity, tier, or order label. A kitchen shift SHALL hold no select
privilege on orders, order lines, dish ticks, order discounts, bills or bill lines.

Every order write, dish tick and Ready SHALL notify its outlet's kitchens and
counters that something changed, without carrying order data.

#### Scenario: A hand-crafted read of the customer

- **WHEN** a kitchen tablet with a live kitchen shift hand-crafts a select of `orders` for its outlet, or of any order's customer columns
- **THEN** the database returns nothing it may not see and refuses the read

#### Scenario: The board carries no money

- **WHEN** the kitchen board is read for an order with a discount and a packaging line
- **THEN** the response carries neither the discount, any amount, nor the packaging line

#### Scenario: The board omits the label and customer

- **WHEN** the kitchen board is read for an order labelled *Rahul* whose customer is saved as *Rahul Das* with a phone
- **THEN** the response carries the order number, without its label, customer's name or phone

#### Scenario: Another outlet's board

- **WHEN** a kitchen tablet hand-crafts a board read naming another outlet
- **THEN** it receives only its own shift's outlet, and no row of the other

## ADDED Requirements

### Requirement: An order's label lives only while the order is on the rail

An order SHALL carry an optional `label` of 1 to 24 characters after trimming, set
and changed by the order commands while the order is open. It SHALL NOT be a
customer field and SHALL NOT change the order's customer. The database SHALL clear
the label in the same write that takes the order off the rail — its cancellation,
or the moment it is both paid and prepared, whether by the counter or by the day
change — and SHALL accept no other change to it on a paid or cancelled order. The
label SHALL NOT be copied to a bill, a receipt or any report.

#### Scenario: Cleared on finishing

- **WHEN** a labelled order is paid and its last dish is then ticked
- **THEN** in the same write the order's label becomes null

#### Scenario: Cleared by the day change

- **WHEN** the day change finishes a paid, labelled order nobody ticked
- **THEN** its label becomes null with its preparation

#### Scenario: Kept while cooking

- **WHEN** a labelled order is paid upfront and its dishes are not yet ticked
- **THEN** it keeps its label on the counter only

#### Scenario: A blank label

- **WHEN** an order command carries a label of only spaces, or of 25 characters
- **THEN** a blank label is stored as none, and an over-long one is refused as malformed

### Requirement: A dish carries an optional note

An item line SHALL carry an optional `note` of 1 to 60 characters after trimming,
set by the order commands and copied to no bill line. A packaging or discount line
SHALL carry none. A revision SHALL be able to change a note only on a line that is
neither ticked nor marked Ready; a revision that changes the note of such a line
SHALL be accepted with the note unchanged.

#### Scenario: A note travels with its line

- **WHEN** an order is saved with a Chicken Shawarma noted *No sauce* and later revised to add Fries
- **THEN** the Chicken Shawarma keeps its note under the same line identity

#### Scenario: A note on packaging

- **WHEN** an order command carries a note on a packaging line
- **THEN** it is refused as malformed

### Requirement: Dish ticks and kitchen Readies are outlet records no other outlet can read

Each dish's counter tick and each kitchen Ready SHALL be stored with its outlet,
order, line, quantity, time, shift and person, under Row-Level Security. A
kitchen's Readies SHALL be append-only, an Undo being a further record. A counter
shift SHALL read its own outlet's dish ticks; a kitchen shift SHALL read its own
Readies only through its board; an outlet's Franchise Admin and the owner SHALL read
both for that outlet. No client role SHALL write either directly. A dish's ready
quantity SHALL be the sum of its Readies not undone, capped at the line's quantity.

#### Scenario: Another outlet's ticks

- **WHEN** a counter tablet with a live counter shift hand-crafts a select of dish ticks naming another outlet's order
- **THEN** it receives nothing

#### Scenario: Another outlet's Readies

- **WHEN** a Franchise Admin of one outlet hand-crafts a select of the other outlet's Readies
- **THEN** it receives nothing

#### Scenario: A Ready written by hand

- **WHEN** a kitchen tablet hand-crafts an insert, update or delete on the Ready records
- **THEN** the database refuses it
