# Counter Billing — delta for `data-model-and-tenancy`

Schema-level write contract for bills. The billing surface itself arrives with
later changes; these requirements bind every writer from day one.

## ADDED Requirements

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
