# Counter Billing

## Purpose

The write contract for bills, enforced in the database so that every writer — the counter tablet today, the offline outbox later — inherits it. Bill numbers are the server's to assign, settled bills are history, line items are snapshots, and a business date the cutover cannot produce is refused. The billing surface itself arrives with later changes; these requirements bind every writer from day one.

## Requirements

### Requirement: Bill numbers are server-assigned and per-outlet sequential

Bill numbers SHALL be assigned by the database at insert time from a
per-outlet sequence. A client-supplied bill number MUST be ignored. Bill
numbers SHALL be unique within an outlet, and an insert that fails (including
a duplicate retry of the same client UUID) MUST NOT consume a number.

#### Scenario: Concurrent settlement at one outlet

- **WHEN** two bills are inserted for the same outlet concurrently
- **THEN** they receive distinct consecutive numbers in that outlet's sequence

#### Scenario: Client supplies its own number

- **WHEN** a bill insert carries a bill number chosen by the client
- **THEN** the stored bill carries the server-assigned number instead

#### Scenario: A duplicate retry burns no number

- **WHEN** a bill insert is retried with a client UUID that already exists, and a new bill is then inserted
- **THEN** the new bill's number is exactly one greater than the last successfully inserted bill's number

### Requirement: Bills are append-only once settled

A settled bill SHALL accept no modification other than the void transition,
which changes only the status and void-attribution fields. Deleting a bill
SHALL be impossible for every client role. Voiding SHALL be available only to
the outlet's Franchise Admin and the Super Admin.

#### Scenario: Editing a settled bill's totals

- **WHEN** any session attempts to update a settled bill's amounts, items, or attribution
- **THEN** the database rejects the update

#### Scenario: Voiding a bill

- **WHEN** a Franchise Admin of the bill's outlet marks it void with a reason
- **THEN** the bill's status becomes void with the voider and time recorded, and every other field is unchanged

#### Scenario: A Biller attempts to void

- **WHEN** a counter device session attempts the void transition
- **THEN** the database rejects the update

### Requirement: Bill line items snapshot the sale and stay internally consistent

Bill line items SHALL store the item name and unit price as charged at the
moment of sale, and SHALL remain valid if the referenced menu item is later
changed or removed. The database SHALL enforce `line_total = unit_price ×
quantity` on every line and `total = subtotal − discount + tax` on every bill,
in integer paise.

#### Scenario: Menu price changes after the sale

- **WHEN** a menu item's price changes after a bill referencing it was settled
- **THEN** the bill's stored line items and totals are unchanged

#### Scenario: Inconsistent totals are rejected

- **WHEN** a bill or line item is inserted whose stored totals violate the arithmetic invariants
- **THEN** the database rejects the insert with a constraint violation

### Requirement: Counter writes are idempotent by client identity

Bills SHALL use the client-generated UUID as their primary key. Submitting the
same bill twice SHALL store it exactly once, and the second submission SHALL
fail as a duplicate rather than create a second row.

#### Scenario: The same bill arrives twice

- **WHEN** the same bill payload with the same client UUID is inserted twice
- **THEN** exactly one row exists, and the second insert is reported as a duplicate

### Requirement: Business date is validated against the outlet cutover

Every bill SHALL carry an explicit business date resolved from the outlet's
cutover time, and the database SHALL reject a bill whose business date does
not match what the outlet's cutover implies for its creation time. A bill
rung after midnight but before cutover belongs to the previous business day.

#### Scenario: A bill rung at 00:20

- **WHEN** a bill created at 00:20 local time is inserted with the previous day as its business date
- **THEN** the insert succeeds

#### Scenario: A bill with an impossible business date

- **WHEN** a bill is inserted whose business date contradicts its creation time under the outlet's cutover
- **THEN** the database rejects the insert

### Requirement: The whole menu is visible at once on a counter tablet

The billing surface SHALL present every available menu item for the outlet at
the same time on a counter tablet, without vertical scrolling and without
requiring a search or a category drill-down. An unavailable item SHALL NOT be
sellable from the grid.

#### Scenario: The menu fits the tablet

- **WHEN** the billing surface is rendered at a counter tablet viewport with the outlet's full menu
- **THEN** the menu region's content height does not exceed its visible height, so nothing is scrolled out of reach

#### Scenario: An unavailable item

- **WHEN** the menu contains an item marked unavailable
- **THEN** that item cannot be added to the current bill

### Requirement: Tapping an item adds it, tapping again increases its quantity

Tapping a menu item SHALL add one of it to the current bill, and tapping the
same item again SHALL increase that line's quantity by one. The item's tile
SHALL show the quantity currently on the bill.

#### Scenario: Adding the same item twice

- **WHEN** a biller taps an item twice
- **THEN** the bill contains one line for that item with a quantity of two

#### Scenario: The tile reflects the bill

- **WHEN** an item is on the current bill
- **THEN** its tile shows the quantity on the bill

### Requirement: Quantity is adjusted on the bill line, and removing a line is possible before settling

Each line on the current bill SHALL offer a decrease and an increase control,
and reducing a line's quantity below one SHALL remove the line. The bill's
running total SHALL update immediately with every change.

#### Scenario: Reducing a line to nothing

- **WHEN** a line with a quantity of one is decreased
- **THEN** the line is removed from the bill and the total is reduced by that line's total

### Requirement: Bill totals are computed by a pure function over integer paise

The current bill's subtotal, tax, discount and total SHALL be computed by a
pure function enforcing `lineTotal = unitPrice × quantity` on every line and
`total = subtotal − discount + tax`, in integer paise. A non-integer paise
value SHALL be rejected rather than rounded.

#### Scenario: A three-line order

- **WHEN** a bill contains lines whose unit prices and quantities are known
- **THEN** each line total equals its unit price times its quantity, and the bill total equals subtotal minus discount plus tax

#### Scenario: A float reaches the money path

- **WHEN** a non-integer paise value is passed to the totals function
- **THEN** it throws rather than rounding

### Requirement: Bill lines snapshot the item name and unit price when the line is created

A line added to the current bill SHALL capture the item's name and unit price
at that moment, and a later change to the menu item SHALL NOT alter a line
already on the bill or a bill already settled.

#### Scenario: A price changes mid-order

- **WHEN** a menu item's price is changed after a line for it is on the current bill
- **THEN** that line's unit price and line total are unchanged

### Requirement: Customer name and phone are optional and never block settling

The billing surface SHALL offer an optional customer name and an optional
customer phone, and SHALL settle a bill whether or not either is supplied. No
validation of these fields SHALL be capable of preventing a settle.

#### Scenario: Settling with no customer details

- **WHEN** a biller settles a complete order with both customer fields empty
- **THEN** the bill is settled and carries no customer name or phone

### Requirement: Payment is one tap, then settle, with cash visually distinct

The billing surface SHALL offer all six payment methods as single-tap choices,
and SHALL mark the cash method distinctly from the others by a means other
than colour alone, because cash alone reaches the drawer. Settling SHALL
require a payment method to have been chosen.

#### Scenario: Two taps from a complete order

- **WHEN** a biller taps a payment method and then settles
- **THEN** the bill is settled with that payment method

#### Scenario: Settling with no method chosen

- **WHEN** a settle is attempted with no payment method chosen
- **THEN** nothing is settled and the surface states that a payment method is needed

### Requirement: Settling never waits for the network and clears the screen at once

Settling SHALL hand the bill to the queue and return without awaiting any
network operation, and the bill panel SHALL be cleared for the next customer
immediately. A confirmation SHALL be shown that clears itself without needing
acknowledgement.

#### Scenario: Settling while offline

- **WHEN** a bill is settled with no connectivity
- **THEN** the bill panel clears, the bill is queued, and no error is shown to the biller

#### Scenario: The confirmation clears itself

- **WHEN** a bill has been settled
- **THEN** the confirmation disappears on its own without the biller acknowledging it

### Requirement: A queued bill carries a provisional reference, never a bill number

Until a bill has been sent, the surface SHALL identify it by a provisional
reference that cannot be mistaken for a bill number, and SHALL state that its
number is assigned when it syncs. A bill number SHALL be assigned only on a
successful send, per outlet and sequentially.

#### Scenario: A bill that has not yet synced

- **WHEN** a settled bill is still queued
- **THEN** it is shown with a provisional reference that is not formatted as a bill number

#### Scenario: A cancelled bill consumes no number

- **WHEN** a queued bill is cancelled before it is sent and a later bill is then sent
- **THEN** the later bill's number is the next in the outlet's sequence, with no gap left by the cancelled one

### Requirement: A settle can be undone only while the bill is still unsent

The settlement confirmation SHALL offer to undo the settle, and SHALL be shown
only while the bill is still unsent — so an undo that is visible is always an
undo that works. The undo SHALL cancel the queued write and restore the order,
its customer details and its payment method to the bill panel. Once the bill
has been sent, no undo SHALL be offered and the bill SHALL NOT be editable by
any means on this surface.

#### Scenario: Undoing while the confirmation is on screen

- **WHEN** a biller undoes a settle from the confirmation
- **THEN** the queued bill is removed and its lines, customer details and payment method are back on the bill panel

#### Scenario: A cancelled bill was never written

- **WHEN** a queued bill is cancelled before it is sent
- **THEN** no bill exists for that client identity, and no correcting record is created

#### Scenario: After the bill is sent

- **WHEN** a settled bill has been sent
- **THEN** the surface offers no undo and no way to change it

### Requirement: Counter writes are idempotent by client identity in every implementation

A bill SHALL be identified by a client-generated UUID from the moment it is
created, and submitting the same identity twice SHALL result in exactly one
bill, with the second submission reported as a duplicate.

#### Scenario: The same queued bill submitted twice

- **WHEN** the same client-generated bill identity is enqueued twice
- **THEN** exactly one bill exists and the second attempt is reported as a duplicate

### Requirement: Every bill carries a business date resolved from the outlet cutover

A bill SHALL be stamped, at the moment it is settled, with the business date
its creation time implies under that outlet's cutover — never with a date
derived from a timestamp when it is read.

#### Scenario: A bill rung after midnight

- **WHEN** a bill is settled at 00:20 local time at an outlet whose cutover is 04:00
- **THEN** the bill carries the previous calendar day as its business date

### Requirement: Billing requires an open shift, and a shift is opened by a biller with a PIN

The billing surface SHALL NOT settle a bill unless a shift is open, and SHALL
say what to do when none is. Opening a shift SHALL require choosing a biller
and entering that biller's PIN, and a wrong PIN SHALL be refused with a single
message that does not distinguish a wrong PIN from an unknown biller.

#### Scenario: No shift open

- **WHEN** the billing surface is opened with no shift open
- **THEN** it states that a shift must be opened and offers the way to open one, rather than showing a disabled settle control

#### Scenario: A wrong PIN

- **WHEN** a PIN that does not match the chosen biller is entered
- **THEN** the shift is not opened and one message is shown that does not reveal which part was wrong

#### Scenario: Handover

- **WHEN** the biller on an open shift closes it and another biller opens one
- **THEN** the open shift is attributed to the incoming biller

### Requirement: Sync state is a persistent indicator with an escalated state, never a dialog

The counter chrome SHALL show the state of the queue at all times as synced,
a count pending, or an escalated warning when the queue has been unable to
drain, and SHALL never interrupt billing with a dialog about it.

#### Scenario: Nothing pending

- **WHEN** the queue is empty
- **THEN** the indicator shows the synced state

#### Scenario: Bills waiting

- **WHEN** bills are queued and not yet sent
- **THEN** the indicator shows how many are pending

#### Scenario: The queue cannot drain

- **WHEN** the number of pending bills reaches the escalation threshold, or the oldest pending bill exceeds the escalation age
- **THEN** the indicator escalates to a warning, and no dialog is shown

