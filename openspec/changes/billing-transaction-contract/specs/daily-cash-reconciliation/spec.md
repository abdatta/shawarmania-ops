## MODIFIED Requirements

### Requirement: Day close snapshots figures computed by the database

Closing a business day SHALL be performed by a database operation that computes
cash receipts from paid cash bills whose `payment_business_date` is that day,
plus that day's cash expenses and withdrawals, inside the transaction that
writes the record. Clients MUST NOT supply derived figures or write the record directly.

#### Scenario: A day is closed
- **WHEN** an FA closes a day supplying only opening cash, counted closing cash, and notes
- **THEN** stored cash sales equal cash actually paid on that payment business date, regardless of the orders' revenue dates

#### Scenario: A client writes the record directly
- **WHEN** any session attempts direct insert or update of a daily cash record
- **THEN** the database rejects the write

### Requirement: A closed day is a snapshot and is never recomputed

Once a business day is closed, its stored figures SHALL NOT change, including
when a cash payment for that payment business date synchronizes after close.

#### Scenario: A late payment lands on a closed drawer day
- **WHEN** a cash bill whose payment business date is already closed arrives later
- **THEN** the closed record remains unchanged and the payment is an exception

### Requirement: The daily cash surface shows every input to the expected closing figure

The daily cash surface SHALL show, for one outlet/payment business date, opening
float, cash receipts, cash expenses, withdrawals, and expected closing, with each
derived value labelled. Cash receipts SHALL include only paid cash bills whose
payment business date matches; revenue business date and non-cash methods SHALL
not move that drawer.

#### Scenario: Deferred cash payment crosses cutoff
- **WHEN** an earlier-date order is paid cash on the selected payment business date
- **THEN** its amount contributes to that selected day's cash receipts

#### Scenario: The expected closing figure
- **WHEN** the surface renders a date's figures
- **THEN** expected closing equals opening plus cash receipts minus cash expenses and withdrawals
