## ADDED Requirements

### Requirement: A kitchen reads unfinished orders without customer, price or payment facts

An outlet's unfinished orders SHALL be readable by a live kitchen shift at that
outlet only through the kitchen board, which SHALL return for each order its
identity, order number, service, table, ordered time, last-changed time, status and
cancelled time, its item lines visible under the tablet's filter (name, quantity
and menu item), the count of its other item lines, and that tablet's own
acknowledgements. It SHALL return no packaging line, no amount of any kind, and no
customer name, phone, identity or tier. A kitchen shift SHALL hold no select
privilege on orders, order lines, order discounts, bills or bill lines.

Every order write SHALL notify its outlet's kitchens that something changed, without
carrying order data.

#### Scenario: A hand-crafted read of the customer

- **WHEN** a kitchen tablet with a live kitchen shift hand-crafts a select of `orders` for its outlet, or of any order's customer columns
- **THEN** the database returns nothing it may not see and refuses the read

#### Scenario: The board carries no money

- **WHEN** the kitchen board is read for an order with a discount and a packaging line
- **THEN** the response carries neither the discount, any amount, nor the packaging line

#### Scenario: Another outlet's board

- **WHEN** a kitchen tablet hand-crafts a board read naming another outlet
- **THEN** it receives only its own shift's outlet, and no row of the other
