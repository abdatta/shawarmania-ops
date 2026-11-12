## MODIFIED Requirements

### Requirement: A delivery ticket says Delivery

A kitchen card for a delivery order SHALL show
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

Counter handover SHALL remove a Done ticket by
fading it where it stood, above the other cards, while the cards below close
the gap at once, as a card leaves the counter's rail: no shrink and no held
blank slot. Reduced motion SHALL keep the fade and drop the slide.

#### Scenario: The counter ticks the last dish of a Done receipt

- **WHEN** the counter ticks the last dish a kitchen's Done receipt covers
- **THEN** the receipt fades in its slot over the board while the card below it slides up its column in the same moment

### Requirement: The kitchen says its part of a ticket is Ready

Every non-cancelled cooking card SHALL carry **Done** as a circular checkbox at
the top right beside the timer. Unchecked it SHALL have a thicker gray outline,
pale interior and gray check inside a timer-sized touch target. Checking SHALL
fill it green, send captured owed lines immediately and exactly once, stop ACK
ringing, and collapse the muted gray ticket to its header. An expand arrow SHALL
replace the timer. Clicking anywhere on the Done card SHALL toggle expansion
both ways, except the Done/Undo control. The arrow SHALL also toggle it. The
checked and unchecked Done circles SHALL have the same outer diameter as the timer.

A Done ticket SHALL persist until every captured item is ticked at the counter.
It SHALL remain undoable whenever visible, with no time limit. Undo SHALL remove
only its readiness, preserving counter handover and making only unhanded food
owed again. A failed write SHALL restore the previous state and report the error.
There SHALL be no progress countdown or outline on the ticket.

Counter handover SHALL remove a Done ticket as *A finished receipt fades while
the board closes up* requires. Unticking SHALL restore it as gray and
Done, rather than making the kitchen cook it again. Each Ready receipt SHALL
remain distinct from later cooking tickets of the same order.

Two kitchens SHALL mark their own dishes Ready independently; a dish both kitchens
show SHALL be ready for both once either marks it.

#### Scenario: Ready on a quiet card

- **WHEN** a kitchen that pressed ACK on an order presses Ready
- **THEN** the counter's dishes fill orange immediately, while the card collapses and remains on the kitchen board until handover

#### Scenario: Ready without ACK

- **WHEN** a kitchen presses Ready on a New card that is still ringing
- **THEN** the ringing stops, the card collapses, and the counter shows the ready-food bell

#### Scenario: Ready races an edit

- **WHEN** the counter raises a Chicken Shawarma from two to three just as the kitchen presses Ready on two
- **THEN** two are ready, and the third arrives on the kitchen as a new ticket

#### Scenario: Undo

- **WHEN** a cook presses Ready by mistake and unchecks its Done control later
- **THEN** only food not already handed over becomes an active ticket again, the checkbox returns to gray, and the counter's Ready fill clears without erasing handover

#### Scenario: Two kitchens

- **WHEN** an order has a Shawarma for one kitchen and a Pasta for another, and only the first presses Ready
- **THEN** only the Shawarma fills orange on the counter, and the Pasta is still on the second kitchen's board

### Requirement: What the kitchen has made never comes back to it

A kitchen's New, Edited and Cancelled states SHALL be judged on food still owed, and
against this tablet's latest acknowledgement made **since its latest Ready** of the
order that was not undone. So:

- Food owed on an order after this kitchen's Ready SHALL arrive as a **new ticket**:
  a New card, numbered *#N · n*, ringing like any new order, showing only the food
  owed.
- Food removed, quantities lowered, or the order cancelled after this kitchen's
  Ready, with nothing left owed here, SHALL show nothing and ring nothing.
- Before Ready, an edit SHALL be Edited and a removal of everything owed Cancelled,
  as for any acknowledged card, compared on owed quantities.

#### Scenario: Something added after Ready

- **WHEN** the kitchen has marked an order of two Shawarmas Ready and the counter adds a Fries
- **THEN** the kitchen shows a New card *#42 · 2* with only the Fries, while the Shawarmas remain in their separate collapsed Done ticket until handover

#### Scenario: One more of a ready dish

- **WHEN** the counter adds one more Shawarma to that order
- **THEN** the kitchen shows a New ticket with one Shawarma

#### Scenario: Removed after Ready

- **WHEN** the counter lowers a Ready line from three to two
- **THEN** no food returns to the cooking ticket and nothing rings; the Done receipt is capped to the remaining quantity

#### Scenario: Cancelled after Ready

- **WHEN** the counter cancels an order whose every dish here was marked Ready
- **THEN** no Cancelled card appears

#### Scenario: Edited while cooking

- **WHEN** the kitchen has pressed ACK but not Ready and the counter lowers a line from three to two
- **THEN** the card reads Edited with the quantity shown three → two until ACK

#### Scenario: Handover and untick

- **WHEN** the counter ticks all items in a Done ticket, then unticks one on an unfinished order
- **THEN** the Done ticket fades out while the board closes up, and returns gray, collapsed, and still undoable
