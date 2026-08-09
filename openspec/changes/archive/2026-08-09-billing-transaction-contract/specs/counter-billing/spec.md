## MODIFIED Requirements

### Requirement: Bill numbers are server-assigned and per-outlet sequential

Bill numbers SHALL be assigned by the database when a paid bill is created from
a pay-now or pay-order command, from a per-outlet sequence inside that command's
transaction. Orders SHALL consume no bill number. A client-supplied number MUST
be ignored. Numbers SHALL be unique within an outlet, and a failed command or
exact replay MUST NOT consume another number.

#### Scenario: Concurrent payment at one outlet
- **WHEN** two valid payment commands for the same outlet execute concurrently
- **THEN** they receive distinct consecutive numbers in that outlet's sequence

#### Scenario: Client supplies its own number
- **WHEN** a payment command carries a bill number chosen by the client
- **THEN** the stored bill carries the database-assigned number instead

#### Scenario: Exact replay burns no number
- **WHEN** an accepted payment command is replayed and a new payment then succeeds
- **THEN** the replay returns its original number and the new bill receives the next number with no gap

### Requirement: Bills are append-only once settled

A paid bill SHALL accept no modification other than the void transition, which
changes only status and void-attribution fields. Deleting a bill SHALL be
impossible for every client role. Voiding SHALL be available only to the bill's
outlet FA and SA, require a reason, and preserve any replacement link as a
separate new bill rather than edited totals.

#### Scenario: Editing a paid bill's totals
- **WHEN** any session attempts to update a paid bill's amounts, items, clocks, or attribution
- **THEN** the database rejects the update

#### Scenario: Voiding a bill
- **WHEN** an authorized admin voids with a reason
- **THEN** status/void attribution change and every original sale field remains unchanged

#### Scenario: Counter attempts to void
- **WHEN** a counter device session attempts the void transition
- **THEN** the database rejects the update

### Requirement: Bill line items snapshot the sale and stay internally consistent

Bill line items SHALL store final item name and unit price snapshots and remain
valid if the menu later changes or removes the item. The database SHALL enforce
line total equals unit price times quantity, bill subtotal equals the sum of all
line totals, and total equals subtotal minus discount plus tax, in integer paise.
Bill and every line SHALL be inserted atomically.

#### Scenario: Menu price changes after order creation
- **WHEN** an existing captured order line is paid after the live menu price changes
- **THEN** the bill uses the order's captured name/price and historical values never change

#### Scenario: Parent subtotal differs from lines
- **WHEN** a payment command's bill subtotal does not equal its submitted line totals
- **THEN** the entire command is refused without a numbered bill

### Requirement: Counter writes are idempotent by client identity

Every bill and command SHALL have client-generated UUIDs. Submitting an exact
command twice SHALL store its effects once and return the same result. Reusing
an identity with different content SHALL be refused as conflict.

#### Scenario: The same paid command arrives twice
- **WHEN** the same payload, version, hash, and command UUID are submitted twice
- **THEN** exactly one bill exists and both responses identify it

#### Scenario: Identity content differs
- **WHEN** the UUID is replayed with a changed payment method or total
- **THEN** no second bill exists and the response is an identity conflict

### Requirement: Revenue date and payment date are explicit and independently validated

Every paid bill SHALL carry `ordered_at` and an explicit `business_date` for
revenue, plus `paid_at` and an explicit `payment_business_date` for the drawer.
Each date SHALL equal what the outlet cutover implies for its matching timestamp.
Paying an order SHALL preserve that order's original pair; a pay-now sale SHALL
resolve both pairs from that transaction's actual times.

The two dates are almost always the same, because an order is paid minutes after
it is taken. They are stored separately so that the exception is representable
rather than silently mis-dated.

#### Scenario: Order before cutover is paid after cutover
- **WHEN** an order created at 03:50 is paid in cash at 04:10 under a 04:00 cutover
- **THEN** its revenue business date is the earlier day and its payment business date is the later day

#### Scenario: Either date is impossible
- **WHEN** a command supplies a revenue or payment date contradicting its matching timestamp/cutover
- **THEN** the database refuses the entire command
