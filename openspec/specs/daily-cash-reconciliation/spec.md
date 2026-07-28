# Daily Cash Reconciliation

## Purpose

Protects the one number a human signs their name to. The daily cash record is computed by the database at close — never supplied by a client — and once closed it is a snapshot that nothing recomputes, so a late-syncing offline bill cannot silently rewrite a counted drawer. The close screen arrives with later changes; these requirements bind how the record can be written at all.

## Requirements

### Requirement: Day close snapshots figures computed by the database

Closing a business day SHALL be performed by a database operation that
computes the day's cash sales, cash expenses, and cash withdrawals
server-side, from that outlet's rows for that business date, inside the same
transaction that writes the record. Clients MUST NOT be able to supply derived
figures or write the daily cash record directly.

#### Scenario: A day is closed

- **WHEN** a Franchise Admin closes a business day supplying only opening cash, counted closing cash, and notes
- **THEN** the stored record's cash sales, cash expenses, and withdrawal figures equal what the database computed from that outlet and date's settled cash bills, cash expenses, and withdrawals

#### Scenario: A client writes the record directly

- **WHEN** any session attempts to insert or update a daily cash record through the data API
- **THEN** the database rejects the write

### Requirement: A closed day is a snapshot and is never recomputed

Once a business day is closed, its stored figures SHALL NOT change — including
when a bill for that business date arrives after the close.

#### Scenario: A late bill lands on a closed day

- **WHEN** a bill whose business date is already closed syncs after the close
- **THEN** the closed record's figures are unchanged

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

The daily cash surface SHALL show, for one outlet and one business date, the
opening float, the cash sales, the cash expenses, the cash withdrawals and the
expected closing amount, with each derived figure labelled as derived. Cash
sales SHALL be taken from settled bills paid in cash for that business date,
and cash expenses from expenses paid in cash for that business date; no other
payment method SHALL contribute to either.

#### Scenario: A day with mixed payment methods

- **WHEN** the surface is opened for a business date whose bills include cash and UPI sales
- **THEN** the cash sales figure counts only the cash bills

#### Scenario: The expected closing figure

- **WHEN** the surface renders a business date's figures
- **THEN** the expected closing equals opening float plus cash sales minus cash expenses minus cash withdrawals

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

