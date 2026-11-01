## ADDED Requirements

### Requirement: An outlet may offer Delivery

Each outlet SHALL carry whether it offers **Delivery**, off by default, changed
by the same people and from the same Orders section as its other service
choices. Delivery SHALL be independent of Dine-in, Takeaway, table numbers and
packaging. Turning Delivery off SHALL stop new delivery orders and SHALL NOT
change an order already marked Delivery. The setting SHALL do nothing while
`delivery-orders` is off.

#### Scenario: Only delivery

- **WHEN** an outlet offers Delivery and neither Dine-in nor Takeaway
- **THEN** the composer's service row shows Delivery alone

#### Scenario: A staff member reaches for the setting

- **WHEN** a Biller crafts a request turning Delivery on
- **THEN** the database refuses it
