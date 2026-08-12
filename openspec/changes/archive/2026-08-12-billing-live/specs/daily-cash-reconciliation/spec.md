## MODIFIED Requirements

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
