## ADDED Requirements

### Requirement: A waiter takes orders from their own phone, under their own login

A person SHALL take orders at an outlet from their own phone when they hold
there a live assignment whose role includes a Waiter: a Waiter or a Biller. They SHALL sign in with their own account. No setup code, tablet or
shift handshake SHALL be involved. The phone shell SHALL
show an **Orders** navigation entry to such a person, and to nobody else, while
`waiter-orders` is on.

#### Scenario: An Employee made a Waiter

- **WHEN** a manager makes an Employee at their outlet a Waiter
- **THEN** one live Waiter assignment replaces the Employee one, their attendance history is unchanged, and they find an Orders tab on their phone at the next read

#### Scenario: A Biller on their own phone

- **WHEN** a person holding a Biller assignment signs in on their own phone
- **THEN** they find the Orders tab, since a Biller includes a Waiter

#### Scenario: An Employee

- **WHEN** an Employee hand-crafts a send for their outlet
- **THEN** the database refuses it `not_a_waiter`

### Requirement: A waiter must be checked in today at the outlet

Every waiter read and send SHALL require an attendance check-in by the caller at
that outlet on the outlet's current business date, as the database reckons it,
that has not been denied. A pending check-in SHALL count.

#### Scenario: Not checked in

- **WHEN** a waiter who has not checked in today opens the Orders tab
- **THEN** the tab says they must check in first and sends nothing

#### Scenario: A denied check-in

- **WHEN** a waiter's only check-in today was denied by a manager
- **THEN** every send is refused `not_checked_in`

### Requirement: Sending requires a recent check that the phone is inside the outlet

The database SHALL compute a presence verdict of `inside`, `outside` or
`unverifiable` from a reading the phone submits, with the distance and accuracy
rules attendance uses, and SHALL keep for each person and outlet only the latest
verdict, its time, distance and accuracy, and the time of the last `inside`
verdict, readable by that person and the owner. It SHALL NOT store the
coordinates. A person SHALL be able to submit at
most one reading every 20 seconds.

Every send and take-back SHALL be refused `not_inside` unless the last `inside`
verdict is within 15 minutes of the database clock. Sending SHALL NOT wait for a
new reading.

#### Scenario: Inside a minute ago

- **WHEN** a waiter whose last inside check was a minute ago sends an order
- **THEN** it is accepted without any new location reading

#### Scenario: Sixteen minutes

- **WHEN** a waiter's last inside check was 16 minutes ago and they hand-craft a send
- **THEN** the database refuses it `not_inside`

#### Scenario: What is kept

- **WHEN** a waiter's phone submits ten readings in half an hour
- **THEN** one row exists for that person and outlet, holding the latest verdict and no coordinates

### Requirement: The Orders tab shows the location light ahead of time

The Orders tab SHALL check the phone's location on opening, on returning to the
foreground, every three minutes while visible, and on **Retry**, and SHALL check
nothing while hidden. It SHALL show:

- 🟢 when the last inside check is under 15 minutes old and the latest verdict is inside;
- 🟡 with the minutes left, when the last inside check is under 15 minutes old and either the latest verdict is not inside or fewer than three minutes remain;
- 🔴 when there is no inside check in the last 15 minutes, saying to turn on location and step inside, with Retry, or saying to allow location when the browser has refused it.

When the latest reading's accuracy is wider than the outlet's radius, 🟡 and 🔴
SHALL say the phone's location is approximate, with its accuracy, and to turn on
precise location.

On 🔴 drafting SHALL still work and sending SHALL NOT. A draft SHALL offer
**Show to counter**, presenting its table, dishes, quantities and notes in large
type.

#### Scenario: GPS weakens before a table

- **WHEN** a waiter's latest check is unverifiable and their last inside check was 8 minutes ago
- **THEN** the light is 🟡 with *7 min left* and Retry, and Send still works

#### Scenario: Precise location off

- **WHEN** a waiter's phone reports an accuracy of ±1,200 m at an outlet with a 100 m radius
- **THEN** the light says the location is approximate (±1.2 km) and to turn on precise location

#### Scenario: Blocked with an order written

- **WHEN** the light turns 🔴 while a waiter has a draft
- **THEN** the draft is kept, Send is greyed with the reason, and Show to counter presents it

### Requirement: A waiter reads every live order at the outlet

A waiter SHALL read, for an outlet where they may take orders and have checked
presence in the last 15 minutes, whatever its verdict: whether a counter shift
is live; every order the counter's rail shows, with its number, table or
service type, label, paid or unpaid, total, and each line's quantity, note,
made quantity and Ready quantity; each order's waiting change and who sent it;
and their own requests of the current business date. A waiter SHALL NOT read any
customer's name, phone or gold mark, nor any bill, tender, discount detail,
points balance or another outlet's row.

#### Scenario: Another waiter's order

- **WHEN** Rahul opens the Orders tab after Priya's table 4 order was accepted
- **THEN** he reads #106 for table 4 with its dishes, made and Ready marks, Unpaid and its total

#### Scenario: An order the counter identified

- **WHEN** a waiter reads an order whose customer the counter identified by phone
- **THEN** no name, phone or gold mark is returned for it

### Requirement: A waiter sends a new order or a change, and it waits for a counter

A waiter SHALL send either a new order (lines, notes, table, service type,
and label, and no customer and no price) or a change to an open order (its
added lines, the unmade food taken off existing lines, changed notes and changed
fields, against the order's version they read). The database SHALL store the
request as waiting and SHALL create no order, allocate no number and show
nothing to any kitchen. Sending SHALL be idempotent by the request's client
UUID. It SHALL be refused:

- `counter_closed` when no counter shift is live at the outlet;
- `order_not_open` for a change to a paid or cancelled order;
- `change_waiting` for a change to an order that already has one waiting;
- `made_food` for a change taking off food already made;
- `malformed` for an item not on the outlet's menu or unavailable, a quantity under one, or a note or label over its limit.

A request SHALL carry no discount, points, payment or preparation.

#### Scenario: Sent

- **WHEN** a waiter sends two Chicken Shawarma for table 4
- **THEN** a waiting request exists, no order exists, and no kitchen tablet shows anything

#### Scenario: A second change

- **WHEN** Priya opens #106 while Rahul's change to it is waiting
- **THEN** she reads that it is waiting and cannot send another

#### Scenario: A paid table wants more

- **WHEN** a waiter tries to change an order already paid
- **THEN** the phone offers a new order for that table instead, and a hand-crafted change is refused `order_not_open`

#### Scenario: No counter

- **WHEN** no counter shift is live at the outlet
- **THEN** the tab says Counter is closed and a hand-crafted send is refused `counter_closed`

### Requirement: A waiter takes back only their own waiting request

A waiter SHALL withdraw a request they sent while it is waiting, under the same
presence rule as sending. Nobody else SHALL withdraw it. A waiter SHALL NOT
cancel an order.

#### Scenario: Taken back

- **WHEN** a customer changes their mind before the counter answers
- **THEN** the waiter takes the request back and it leaves the counter's rail

#### Scenario: Cancelling an accepted order

- **WHEN** a waiter hand-crafts a cancel for an accepted order
- **THEN** the database refuses it

### Requirement: The counter accepts a request from a composer already filled in

A counter shift at the outlet SHALL see every waiting request at the top of its
rail, oldest first, as a card distinct from an order, naming the sender, the
table and the dishes, or the change as additions, reductions and changed
fields. A new card SHALL ring once.

Opening a new request SHALL fill the composer as if its dishes had been tapped,
with Accept in place of Order and Reject beside it. Opening a change SHALL open
the order in the edit composer with the change applied and marked, with Accept
in place of Save, and SHALL say so when the order changed after the request was
sent. Edits that can no longer apply SHALL be listed and not applied. A draft in
progress SHALL be restored afterwards.

Accept SHALL create or revise the order through the ordinary command, which
SHALL mark the request accepted in the same transaction. The order number SHALL
be allocated then. A request no longer waiting SHALL make the command refuse
`request_not_waiting` and create or change nothing. Accept and Reject SHALL be
offered only while the tablet is online.

#### Scenario: Accepted

- **WHEN** the counter opens a waiting request for table 4 and taps Accept
- **THEN** order #106 exists with the request's lines priced from the counter's menu, the kitchen tablets alert as for any new order, and the waiter's card reads Accepted as #106

#### Scenario: Corrected before accepting

- **WHEN** the biller adds a Coke to the filled composer before Accept
- **THEN** the order holds the Coke, attributed to the counter

#### Scenario: Taken back while open on the counter

- **WHEN** the waiter takes a request back while the counter has it open, and the counter then taps Accept
- **THEN** no order is created and the counter says the request was taken back

#### Scenario: A change after the counter's own edit

- **WHEN** the counter added a Pepsi to #106 after Rahul sent +1 Burger
- **THEN** Accept's composer holds the Pepsi and the Burger, and says the order changed after Rahul sent the change

### Requirement: The counter rejects a request in one tap

Reject SHALL need no reason and SHALL mark the request rejected, attributed to
the tablet and operator. The waiter SHALL read *Rejected by counter* until they
dismiss it.

#### Scenario: Rejected

- **WHEN** the counter rejects a request
- **THEN** it leaves the rail and the waiter's card reads Rejected by counter

### Requirement: A request carries no customer

A request SHALL be refused `malformed` if it carries any customer phone or name.
The label MAY hold a name the waiter chooses, and SHALL NOT change the order's
customer. A request SHALL never be copied to a bill, a receipt or a report.

#### Scenario: A hand-crafted phone

- **WHEN** a waiter hand-crafts a request with a customer phone
- **THEN** the database refuses it `malformed`

#### Scenario: A name as the label

- **WHEN** a waiter labels a new order *Priya* and the counter accepts it
- **THEN** the order's label is Priya and it has no customer until the counter identifies one

### Requirement: A waiting request expires with its business day

A request still waiting after its outlet's business date has passed SHALL read as
expired, with nothing written, and SHALL refuse Accept. Finish Day on a counter
SHALL name the outlet's waiting requests of that business date and SHALL NOT
proceed until each is accepted or rejected.

#### Scenario: Forgotten at close

- **WHEN** a request is still waiting at Finish Day
- **THEN** Finish Day names it and waits for Accept or Reject

#### Scenario: After cutover

- **WHEN** a request from yesterday's business date is still waiting
- **THEN** the waiter reads it as expired and not sent to the kitchen, and the counter cannot accept it

### Requirement: Waiter rows are outlet records no other outlet can read

Requests and presence rows SHALL each be readable only within their outlet, by
the roles named here: requests by the outlet's waiters and billers, its live
counter shifts, the owner and its managers; presence by the person and the
owner. No client role SHALL insert, update or delete any of them directly. A
kitchen shift SHALL read none of them.

#### Scenario: Another outlet

- **WHEN** a waiter at one outlet hand-crafts a read of another outlet's requests
- **THEN** the database returns nothing

#### Scenario: A manager and a location

- **WHEN** a manager hand-crafts a read of a waiter's presence row
- **THEN** the database returns nothing

### Requirement: Waiter ordering is behind `waiter-orders`

With `waiter-orders` off, no phone SHALL show the Orders tab, Team SHALL offer
no Waiter choice, no counter SHALL read or subscribe to requests,
and every waiter and request function SHALL refuse `gate_off`. Turning it off
SHALL leave every Waiter, request and accepted order in place, a Waiter still
checking in and recording expenses as an Employee does, and turning it on
SHALL bring waiting requests back to the rail.

#### Scenario: Pulled mid-service

- **WHEN** the owner turns `waiter-orders` off with a change waiting
- **THEN** the counter rings and edits as today, the accepted orders stay on the rail, and turning it back on returns the waiting change
