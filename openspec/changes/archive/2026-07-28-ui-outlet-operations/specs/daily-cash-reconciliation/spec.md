# Daily Cash Reconciliation

## ADDED Requirements

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
