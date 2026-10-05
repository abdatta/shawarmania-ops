## MODIFIED Requirements

### Requirement: An order records how it was served, and may be called by its table

An order SHALL record whether it was dine-in, takeaway or neither, and a dine-in
order MAY record a table number. A bill SHALL copy both from its order, or take
them from a direct sale's own payload. Both SHALL be snapshots. No later change
to the outlet's choices SHALL alter them. Both MAY change while the order is open
and SHALL be fixed at payment.

Where an order has a table, the counter SHALL show its order number followed by
its table, as `#106 · Table 8`. An order with a table SHALL show its table even
while its number has not yet arrived.
Where an order has a type and no table, its pipeline card SHALL say whether it is
dine-in or takeaway, so the kitchen can tell a plate from a parcel.
The order number SHALL still be allocated and
stored, and SHALL remain what history, voids and manager surfaces identify the
order by.

#### Scenario: The number leads and the table follows it

- **WHEN** order 106 for table 8 is on the pipeline
- **THEN** its card reads #106 · Table 8

#### Scenario: A parcel with no table

- **WHEN** a takeaway order is on the pipeline
- **THEN** its card says Takeaway beside its number

#### Scenario: The outlet stops offering dine-in

- **WHEN** the owner turns dine-in off after dine-in orders were paid
- **THEN** those bills still record dine-in and their tables

#### Scenario: A paid order is re-marked

- **WHEN** any caller attempts to change the type or table of a paid order
- **THEN** the database refuses it
