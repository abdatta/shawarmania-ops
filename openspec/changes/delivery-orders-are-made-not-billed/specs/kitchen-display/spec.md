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

### Requirement: A finished receipt fades while the board closes up

While `delivery-orders` is on, counter handover SHALL remove a Done ticket by
fading it where it stood, above the other cards, while the cards below close
the gap at once, as a card leaves the counter's rail: no shrink and no held
blank slot. Reduced motion SHALL keep the fade and drop the slide. With the
gate off, the ticket SHALL leave as `kitchen-display` otherwise requires.

#### Scenario: The counter ticks the last dish of a Done receipt

- **WHEN** `delivery-orders` is on and the counter ticks the last dish a kitchen's Done receipt covers
- **THEN** the receipt fades in its slot over the board while the card below it slides up its column in the same moment
