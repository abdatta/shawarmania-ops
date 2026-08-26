## ADDED Requirements

### Requirement: One expense record, promoted from the notebook rather than migrated into an empty table

The business SHALL hold exactly one expense table. It SHALL be the table that
already carries the production rows, promoted by rename, and the unused table
created alongside the original demo surfaces SHALL be dropped.

The promoted record SHALL retain, without reimplementation, every property the
notebook's expense row accumulated: a free-text category snapshot, an explicit
`business_date`, an occurrence instant, integer paise, a cash or non-cash
method, the account that recorded it, the account that last corrected it, the
void state with its actor and reason, and whether it was recorded by somebody
holding no assignment at that outlet.

No expense row SHALL be copied between tables, because copying is what loses the
properties above.

#### Scenario: The rows survive in place

- **WHEN** the promotion runs
- **THEN** every existing expense row keeps its identity, category text, attribution, void state and recorded-from-away marker, and no row is inserted or deleted

#### Scenario: The empty table is gone

- **WHEN** the schema is inspected afterwards
- **THEN** exactly one expense table exists and nothing references the dropped one

#### Scenario: Staff correction rules are unchanged by the promotion

- **WHEN** a staff member corrects their own expense on the day they recorded it
- **THEN** it behaves exactly as it did before the promotion, and a correction outside that window is refused as before

### Requirement: The consumption basis names a category that exists, or does not exist at all

Any reporting basis that identifies stock spending by category SHALL match
against the category text the promoted table actually holds. A basis that
matches a value from a closed list nothing types any more SHALL NOT remain in
place quietly matching nothing; it SHALL either be corrected to match real
categories or withdrawn.

#### Scenario: A basis that matches nothing is not left standing

- **WHEN** the reporting bases are evaluated after the promotion
- **THEN** no basis silently returns zero because it matches a category no person can type
