## MODIFIED Requirements

### Requirement: The kitchen screen shows the rail's unprepared orders, oldest first by default

A tablet of kind `kitchen` holding a live kitchen shift SHALL show every order at its
outlet that is not yet prepared — open or paid, with no Prepared tick — and has food
still **owed** under the tablet's filter, ordered by `ordered_at` ascending unless the
tablet is set to newest first. A line's owed quantity is its quantity less what a
kitchen has marked Ready or the counter has ticked. The sort SHALL be saved on the
tablet's own record beside its filter and changeable from the same sheet, oldest
first being the default. An order SHALL leave the screen when nothing visible here is
owed — when this kitchen marks it Ready, when the counter ticks its dishes, or when it
is marked prepared by the day change — without any action in the kitchen. A direct
sale with no order SHALL NOT appear. The screen SHALL NOT be filtered by business
date.

Each card SHALL show the order number as its most prominent text, followed by
*· n* when it is the order's second or later ticket here; the order's **label**, when
it has one, beneath the number; its service as the counter's pipeline card names it
(*Takeaway*, *Dine-in* or *Table N*); each visible line with food owed, led by a large
owed quantity, with the line's **note** beneath it in a tone that stands out from the
dish name; the time since it was ordered; and — when the order has item lines not
visible here — the count of them as *+N item(s) for another kitchen*. It SHALL NOT
show a price, a total, a discount, a payment state, a packaging line, or the
customer's name or phone.

The waiting time SHALL take the warning tone from ten minutes and the danger tone
from twenty.

The board SHALL NOT scroll by itself. While a card awaiting ACK is out of sight, a
floating pointer SHALL say so, naming the order when there is one and counting them
when there are several, in the colour of the most urgent of them, with an arrow
towards it, and a tap SHALL bring that card into view.

#### Scenario: An order is taken at the counter

- **WHEN** a counter tablet saves an order with a Chicken Shawarma and a Pasta, and the kitchen tablet shows everything except Pasta
- **THEN** within seconds the kitchen shows the order with Chicken Shawarma and *+1 item for another kitchen*, below every older order

#### Scenario: The counter ticks the dishes

- **WHEN** the counter ticks every dish of an order this kitchen shows
- **THEN** the order leaves the kitchen screen without an ACK, and any ringing for it stops

#### Scenario: Paid upfront, still cooking

- **WHEN** an order is paid but its dishes are neither ticked nor Ready
- **THEN** it stays on the kitchen screen

#### Scenario: A pay-now sale

- **WHEN** the counter rings a direct sale with no order
- **THEN** nothing appears on the kitchen screen

#### Scenario: A label and a note

- **WHEN** the counter saves an order labelled *Red shirt* with a Chicken Shawarma noted *No sauce*
- **THEN** the kitchen's card shows *Red shirt* under the number and *No sauce* under the Chicken Shawarma

#### Scenario: A note for the other kitchen

- **WHEN** the noted dish is one this kitchen does not show
- **THEN** this kitchen's card shows neither the dish nor its note

#### Scenario: A new order lands below the screen

- **WHEN** the board holds more cards than fit and a new order arrives below the visible ones
- **THEN** a pointer reads *↓ New #N*, and tapping it scrolls that card into view

#### Scenario: The kitchen prefers the newest on top

- **WHEN** the kitchen chooses *Newest first* in the filter sheet and saves
- **THEN** the board lists the newest order first, and still does after a reload

## ADDED Requirements

### Requirement: The kitchen says its part of a ticket is Ready

Every card SHALL carry **Ready** beside ACK, at any state. Ready SHALL record, on the
server, the lines and owed quantities this tablet was showing, for this tablet,
idempotently, and SHALL answer for ACK: a card marked Ready needs no ACK. It SHALL be
accepted even if the order changed after the board was read, recording only what was
shown; food added meanwhile stays owed. It SHALL be refused for a cancelled or
finished order and for a tablet without a live kitchen shift.

The card SHALL leave the board at once, and the kitchen SHALL be offered **Undo** for
about ten seconds. Undo SHALL restore the card as it was before Ready, and SHALL be
refused once the counter has ticked any of its dishes or two minutes after the Ready.

Two kitchens SHALL mark their own dishes Ready independently; a dish both kitchens
show SHALL be ready for both once either marks it.

#### Scenario: Ready on a quiet card

- **WHEN** a kitchen that pressed ACK on an order presses Ready
- **THEN** the card leaves its board and the counter's dishes for it shake

#### Scenario: Ready without ACK

- **WHEN** a kitchen presses Ready on a New card that is still ringing
- **THEN** the ringing stops, the card leaves, and the counter's bell for this kitchen goes quiet

#### Scenario: Ready races an edit

- **WHEN** the counter raises a Chicken Shawarma from two to three just as the kitchen presses Ready on two
- **THEN** two are ready, and the third arrives on the kitchen as a new ticket

#### Scenario: Undo

- **WHEN** a cook presses Ready by mistake and taps Undo
- **THEN** the card returns exactly as it was, and the counter's dishes stop shaking

#### Scenario: Two kitchens

- **WHEN** an order has a Shawarma for one kitchen and a Pasta for another, and only the first presses Ready
- **THEN** only the Shawarma shakes on the counter, and the Pasta is still on the second kitchen's board

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
- **THEN** the kitchen shows a New card *#42 · 2* with only the Fries, and nothing about the Shawarmas

#### Scenario: One more of a ready dish

- **WHEN** the counter adds one more Shawarma to that order
- **THEN** the kitchen shows a New ticket with one Shawarma

#### Scenario: Removed after Ready

- **WHEN** the counter lowers a Ready line from three to two
- **THEN** the kitchen shows nothing and rings nothing

#### Scenario: Cancelled after Ready

- **WHEN** the counter cancels an order whose every dish here was marked Ready
- **THEN** no Cancelled card appears

#### Scenario: Edited while cooking

- **WHEN** the kitchen has pressed ACK but not Ready and the counter lowers a line from three to two
- **THEN** the card reads Edited with the quantity shown three → two until ACK
