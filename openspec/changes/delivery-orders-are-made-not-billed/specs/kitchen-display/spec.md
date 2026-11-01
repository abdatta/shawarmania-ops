## ADDED Requirements

### Requirement: A delivery ticket says Delivery

While `delivery-orders` is on, a kitchen card for a delivery order SHALL show
**Delivery** where a service would be named, and SHALL otherwise behave as any
card: it rings until acknowledged, is marked Ready, and shows no label, price
or customer. A handed-over delivery order SHALL leave the board as a finished
order does, and SHALL NOT ring as a cancellation.

#### Scenario: A Zomato order reaches the kitchen

- **WHEN** the counter saves a delivery order labelled with a platform's order ID
- **THEN** the kitchen rings, the card reads its order number and Delivery, and the ID is not shown

#### Scenario: Handed over before Ready

- **WHEN** the counter hands over a delivery order the kitchen has not marked Ready
- **THEN** the card leaves the board and no cancellation alert rings
