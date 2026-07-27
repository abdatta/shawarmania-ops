# Daily Cash Reconciliation — delta for `data-model-and-tenancy`

Schema-level contract for the daily cash record. The close screen arrives with
later changes; these requirements bind how the record can be written at all.

## ADDED Requirements

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
