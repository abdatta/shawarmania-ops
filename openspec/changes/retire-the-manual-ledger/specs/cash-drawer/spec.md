## ADDED Requirements

### Requirement: A carried legacy observation states that its hour was never recorded

An observation created by carrying a historical hand-recorded day SHALL be a
first-class observation, participating in the same interval arithmetic and the
same carry-forward, and SHALL be marked **legacy imprecise**, distinctly from the
ordinary approximate marker.

A legacy observation SHALL NOT be presented with a time of day and SHALL NOT
carry a rupee tolerance, because the instant it is placed at is a boundary chosen
by the carry-over rather than a moment anybody observed. Its marker SHALL state
plainly, on the record, that the hour was never captured.

The source row's cash removed SHALL become cash out of kind `spend` where it
carried a reason and `collection` where it did not, at the same instant. A source
row's cash added SHALL be carried as an adjustment against the observation,
retaining its original reason, so the arithmetic closes and the explanation
survives.

#### Scenario: A carried day renders without a time

- **WHEN** a legacy observation is shown on the ledger or the drawer surface
- **THEN** it shows its date and its figures, states that the hour was never recorded, and shows no time of day and no tolerance

#### Scenario: A legacy observation anchors the balance like any other

- **WHEN** the observation after a legacy one is recorded
- **THEN** its opening is the legacy observation's counted total less that observation's own cash out, by the ordinary rule

#### Scenario: A carried removal keeps its reason

- **WHEN** a source row recorded cash removed with a reason
- **THEN** the carried cash out is of kind spend and carries that reason

#### Scenario: An approximate observation and a legacy one are distinguishable

- **WHEN** both appear in one month's reading
- **THEN** they carry different markers, and only the approximate one carries a tolerance figure

### Requirement: The carry-over reproduces figures already known, or it does not complete

The migration carrying historical rows SHALL assert, inside the same transaction
that performs it, that the carried data reproduces totals established before it
ran: each outlet's monthly cash and non-cash expense totals, each outlet's count
of expense rows including voided ones, and each carried observation's counted
total against its source row.

It SHALL further assert that every carried row carries a recording account, that
every corrected row carries a correcting account, and that every voided row
carries its reason.

A failed assertion SHALL abort the whole migration, leaving every source row and
every existing record untouched.

#### Scenario: A carry-over that does not reconcile

- **WHEN** any asserted total differs from the figure established before the migration
- **THEN** the transaction raises and nothing is archived, renamed or dropped

#### Scenario: Attribution is not optional

- **WHEN** a source row would carry across without its recording account
- **THEN** the migration raises rather than writing an unattributed row
