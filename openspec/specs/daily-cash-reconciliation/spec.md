# Daily Cash Reconciliation

## Purpose

Protects the one number a human signs their name to. The daily cash record is computed by the database at close — never supplied by a client — and once closed it is a snapshot that nothing recomputes, so a late-syncing offline bill cannot silently rewrite a counted drawer. The close screen arrives with later changes; these requirements bind how the record can be written at all.

## Requirements

### Requirement: Day close snapshots figures computed by the database

Closing a business day SHALL be performed by a database operation that computes
cash receipts from the latest accepted effective allocations of paid bills whose
`payment_business_date` is that day, plus that day's cash expenses and
withdrawals, inside the transaction that writes the record. A superseded original
allocation and an earlier correction revision SHALL NOT also contribute. Clients
MUST NOT supply derived figures or write the record directly.

#### Scenario: A day is closed

- **WHEN** an FA closes a day supplying only opening cash, counted closing cash, and notes
- **THEN** stored cash sales equal cash actually paid on that payment business date after accepted tender corrections, regardless of the orders' revenue dates

#### Scenario: A client writes the record directly

- **WHEN** any session attempts direct insert or update of a daily cash record
- **THEN** the database rejects the write

#### Scenario: A bill changed from Cash to UPI inside its edit window

- **WHEN** day close computes cash receipts after the accepted correction
- **THEN** that bill contributes no cash receipt, its UPI allocation is not drawer cash, and its original Cash allocation is not counted

### Requirement: A closed day is a snapshot and is never recomputed

Once a business day is closed, its stored figures SHALL NOT change, including
when a cash payment for that payment business date synchronizes after close.

#### Scenario: A late payment lands on a closed drawer day

- **WHEN** a cash bill whose payment business date is already closed arrives later
- **THEN** the closed record remains unchanged and the payment is an exception

### Requirement: The reconciliation arithmetic is enforced as constraints

The database SHALL enforce, on every daily cash record:
`expected_closing = opening_cash + cash_sales − cash_expenses −
cash_withdrawn` and `difference = actual_closing − expected_closing`, in
integer paise, with a shortfall producing a negative difference.

#### Scenario: An inconsistent record is rejected

- **WHEN** a write attempts to store a record violating either equation
- **THEN** the database rejects it with a constraint violation

### Requirement: One close per outlet per business day, by that outlet's Franchise Admin

Each outlet SHALL have at most one daily cash record per business date.
Closing SHALL be available only to an active Franchise Admin of that outlet —
deliberately not the Super Admin, and never another outlet's admin.

#### Scenario: A second close of the same day

- **WHEN** a close is attempted for an outlet and business date that already has a record
- **THEN** the operation is rejected

#### Scenario: The wrong role attempts a close

- **WHEN** a Super Admin, Biller, or Employee session attempts to close a day
- **THEN** the operation is rejected

### Requirement: The daily cash surface shows every input to the expected closing figure

The daily cash surface SHALL show, for one outlet/payment business date, opening
float, cash receipts, cash expenses, withdrawals, and expected closing, with each
derived value labelled. Cash receipts SHALL include only the latest accepted
effective Cash allocation of paid bills whose payment business date matches;
superseded allocations, revenue business date and non-cash methods SHALL not move
that drawer.

#### Scenario: Deferred cash payment crosses cutoff

- **WHEN** an earlier-date order is paid cash on the selected payment business date
- **THEN** its effective Cash allocation contributes to that selected day's cash receipts

#### Scenario: The expected closing figure

- **WHEN** the surface renders a date's figures
- **THEN** expected closing equals opening plus effective cash receipts minus cash expenses and withdrawals

#### Scenario: A split is corrected without changing the sale total

- **WHEN** an accepted correction moves part of a bill between Cash and UPI before finish-day confirmation
- **THEN** cash receipts and expected closing move by exactly that part while total bill revenue stays unchanged

### Requirement: The difference appears the moment the counted amount is entered

The surface SHALL accept the actual counted cash amount and SHALL show the
difference from the expected closing immediately, before anything is
submitted. The difference SHALL be shown with its direction stated in words as
well as by sign, with a shortfall negative.

#### Scenario: A drawer that is short

- **WHEN** a counted amount below the expected closing is entered
- **THEN** the difference is shown immediately, is negative, and is described as a shortfall

#### Scenario: A drawer that is over

- **WHEN** a counted amount above the expected closing is entered
- **THEN** the difference is shown immediately, is positive, and is described as an excess

#### Scenario: A drawer that balances

- **WHEN** a counted amount equal to the expected closing is entered
- **THEN** the difference is shown as zero and described as balancing

### Requirement: The reconciliation arithmetic is a shared, pure function in integer paise

The expected closing and the difference SHALL be computed by pure domain
functions over integer paise, mirroring the constraints the database enforces
on the stored record. A non-integer input SHALL be rejected rather than
rounded.

#### Scenario: A float reaches the cash arithmetic

- **WHEN** a non-integer paise value is passed to the reconciliation arithmetic
- **THEN** it throws rather than rounding

### Requirement: Closing a day states what it does and then freezes the figures

Closing a business day SHALL state, before it is confirmed, that the figures
are snapshotted and that the day cannot be closed again. After a close, the
surface SHALL show the stored figures as closed, and SHALL offer no way to
re-close or edit that day.

#### Scenario: Closing the day

- **WHEN** a Franchise Admin confirms a close with a counted amount
- **THEN** the stored record carries the counted amount, the expected closing, and the difference, and the day is shown as closed

#### Scenario: A closed day

- **WHEN** a business date that has already been closed is shown
- **THEN** the stored figures are displayed and no close or edit action is offered

### Requirement: A bill arriving against a closed day raises a visible exception

A closed day's stored figures SHALL remain unchanged when a bill for that
business date is recorded afterwards, and the surface SHALL show a
reconciliation exception naming the bill and its amount and stating that the
closed figures were not altered.

#### Scenario: A late bill lands on a closed day

- **WHEN** a bill for a business date that is already closed is recorded
- **THEN** the closed record's figures are unchanged and the surface shows a reconciliation exception naming that bill

### Requirement: A cash withdrawal is recorded against the day and reduces the expected closing

Recording a cash withdrawal SHALL ask for an amount, who took it, and an
optional reason, and SHALL reduce the day's expected closing by exactly that
amount.

#### Scenario: Recording a withdrawal

- **WHEN** a withdrawal is recorded for a business date that is not closed
- **THEN** the day's withdrawals figure increases by that amount and the expected closing decreases by the same amount
