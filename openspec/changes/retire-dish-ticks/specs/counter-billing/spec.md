## MODIFIED Requirements

### Requirement: A saved order enters the preparation pipeline

On saving, the surface SHALL put the order directly into the pipeline list at
its newest end, where its complete quantity-and-item lines SHALL be the primary
information, followed by the customer name when one exists and the prominent
total. Where the order was rung for a member, its card SHALL carry the member
mark, read from the order's own snapshot, so preparation can be ordered or
handled differently. Its order number SHALL remain visible as a secondary
reference until payment or cancellation. The surface SHALL NOT add a separate
latest-order card that can represent only one of several rapid orders. The order
number SHALL be visually distinct from a bill number wherever both could be
seen.

The order SHALL be in the pipeline list as soon as the tablet has saved it,
drawn from the tablet's own record, without waiting for any server response.
Until the server assigns its number, the card SHALL show the shape of the number
and nothing else. The card SHALL be as usable as any other order on the rail,
and SHALL NOT be shown disabled, greyed or as a loading placeholder while the
server's answer is outstanding. When the server answers, its answer SHALL
replace what was drawn.

#### Scenario: The order is saved

- **WHEN** an order is accepted
- **THEN** its preparation items and total appear immediately at the newest end of the pipeline list, its customer is shown when known, and its order number remains available as a small reference

#### Scenario: The order is saved on a slow connection

- **GIVEN** the server has not yet answered any read made after the save
- **WHEN** the biller presses Order
- **THEN** the order's card is on the rail with its dishes, notes, label, customer and total, and the awaiting shape of its number, before any server response arrives

#### Scenario: A just-saved order is worked before the server answers

- **GIVEN** an order was saved while the server has not answered
- **WHEN** the biller ticks one of its dishes, pays it, edits it or cancels it
- **THEN** the action is taken exactly as it is on any other order of this tablet

#### Scenario: The server answers

- **GIVEN** a saved order drawn from the tablet's own record
- **WHEN** the server's read arrives with the order and its number
- **THEN** the card shows the number in place of its shape, and nothing else on the card moves

#### Scenario: A member's order reaches the pipeline

- **WHEN** an order rung for a member appears in the pipeline list
- **THEN** its card carries the member mark, and it carries no membership date, actor or figure

#### Scenario: The order is paid

- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable

### Requirement: The owner's Orders tab says what the counter's card says

Each open order on the billing history's Orders tab SHALL show, compactly: its
number, label and total; when it was ordered and how long ago, who rang it, and
its table or takeaway; whether it is paid; each kitchen's answer in words (sent,
seen, ready, served); each dish with its quantity, note and price in one of four
states — placed, acknowledged, Done, handed over — in the counter's marks (✓, ✓✓,
the bell, a ticked box), each named on hover and to a screen reader; and the
customer on one line beside Cancel order. A dish SHALL read acknowledged only when
every kitchen still owing it has acknowledged at least what it owes. The kitchens'
answers SHALL come from a read that only the owner and that outlet's franchise
admins may make. Opening the page SHALL only count the open orders; choosing the
Orders tab, or tapping it again, SHALL read the orders and their kitchens afresh,
never on a timer; if the kitchens' read fails the orders SHALL still list.

#### Scenario: The owner checks an order from away

- **WHEN** the owner opens the Orders tab while Kitchen 1 has acknowledged one dish of an unpaid order, marked another Done and the counter has handed over a third
- **THEN** the card says Not paid and Kitchen 1 · ready, and the three dishes show ✓✓, the bell and a ticked box

#### Scenario: Another outlet's manager cannot read these kitchens

- **WHEN** a franchise admin of another outlet asks for this outlet's kitchens
- **THEN** the read is refused, as reading its orders is

### Requirement: The counter draws its own saves before the server answers

Every change this tablet saves to an order or a bill SHALL be on screen as soon
as the tablet has saved it, drawn from the tablet's own record, and SHALL NOT
wait for a server response. This covers an edited order's card, a payment's bill
in Bills this shift (from Pay now or from a rail card) with the shift's cash and
UPI totals, a corrected tender, a payment taken back (its order back on the
rail), and an order cancelled after payment.

Each save SHALL cause the one server read it would cause without the drawing,
and no more. A read that began before a save SHALL NOT draw the rail or Bills
without that save. When the server's read arrives, it SHALL replace what was
drawn.

#### Scenario: Save on a slow connection

- **GIVEN** an order with two dishes is open for edit
- **WHEN** the biller adds a third dish and presses Save while the server has not answered
- **THEN** the order's card shows all three dishes and the new total at once

#### Scenario: Pay now on a slow connection

- **GIVEN** the server has not answered
- **WHEN** the biller settles a bill with Pay now
- **THEN** the bill is in Bills this shift at once with the awaiting shape of its number, and the cash or UPI total includes it

#### Scenario: Taking a payment back from Bills

- **GIVEN** the server has not answered
- **WHEN** the biller takes back a paid order's payment from Bills this shift
- **THEN** the bill shows as taken back and the order is back on the rail, unpaid, at once

#### Scenario: An older read lands after a save

- **GIVEN** a rail read began before the biller pressed Order
- **WHEN** that read's answer arrives after the order was drawn
- **THEN** the new order's card stays on the rail throughout

#### Scenario: The counter makes no extra requests

- **WHEN** an idle counter, an ACK and a payment are measured with every gate on
- **THEN** their requests are within the request budget, unchanged by this requirement

### Requirement: A re-read that fails after a save does not report the save as failed

A save's confirmation SHALL stand once the tablet has saved it, and a failure of
the server read that follows SHALL NOT replace it with the save's failure words.
A server read of Bills this shift that fails while the panel shows a list SHALL
keep the list and SHALL show no error; the panel SHALL say it could not load the
shift only when it has nothing to show.

#### Scenario: Take back, then the re-read fails

- **WHEN** the biller takes back a payment and the server read that follows fails
- **THEN** the panel says the payment was taken back, and does not say the item could not be resolved

#### Scenario: Bills keeps its list when the server fails

- **GIVEN** Bills this shift shows the shift's bills
- **WHEN** a re-read of the shift fails
- **THEN** the bills stay on screen with no error message

### Requirement: The table picker opens on the tables the counter already knows are busy

Opening the table picker SHALL mark busy every table held by an order the tablet
already holds, without waiting for a server response, and SHALL then correct
itself from the server's read.

#### Scenario: A table taken a moment ago

- **GIVEN** an order for table 4 was just saved on this tablet while the server has not answered
- **WHEN** the biller opens the table picker for the next order
- **THEN** table 4 is marked busy
