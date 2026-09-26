## ADDED Requirements

### Requirement: An order records how it was served, and may be called by its table

An order SHALL record whether it was dine-in, takeaway or neither, and a dine-in
order MAY record a table number. A bill SHALL copy both from its order, or take
them from a direct sale's own payload. Both SHALL be snapshots. No later change
to the outlet's choices SHALL alter them. Both MAY change while the order is open
and SHALL be fixed at payment.

Where an order has a table, the counter SHALL call it by its table where it would
otherwise show the order number, and SHALL NOT show the order number beside it.
The order number SHALL still be allocated and
stored, and SHALL remain what history, voids and manager surfaces identify the
order by.

#### Scenario: A table replaces the number at the counter

- **WHEN** an order for table 4 is on the pipeline
- **THEN** its card reads Table 4, and the order still carries its daily order number

#### Scenario: The outlet stops offering dine-in

- **WHEN** the owner turns dine-in off after dine-in orders were paid
- **THEN** those bills still record dine-in and their tables

#### Scenario: A paid order is re-marked

- **WHEN** any caller attempts to change the type or table of a paid order
- **THEN** the database refuses it
