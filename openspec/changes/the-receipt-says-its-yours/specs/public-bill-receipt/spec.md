## MODIFIED Requirements

### Requirement: The public receipt names no customer

The receipt SHALL NOT show the customer's name, in whole or in part, in any form.

The receipt SHALL NOT show the customer's phone number, or any part of it, except
the last four digits of the number the bill recorded.

The receipt SHALL show the last four digits of the recorded number, and SHALL show
that the customer was a gold member at the bill's outlet, **only for a bill that
has a customer attached**. A bill with no customer attached, including every bill
rung before customers were identified by their number, SHALL show neither, whatever
text the bill carries in its name and phone columns.

Both facts SHALL be read from the bill's own stored values, never from the customer
directory or from current membership, so that a later change to the directory or a
revoked membership does not change a receipt already issued.

The full phone number SHALL NOT leave the database in the receipt's payload. The
omission SHALL be the reader function's own projection, not a renderer choosing
what to show.

The receipt SHALL NOT show any other person's identity: not the biller, not the
approving manager, not the till.

*Why this reads as it does.* A receipt link is a bearer token in a URL: whoever
holds it, forwarded or misdelivered, sees the bill. The rule since #54 has been
that a leaked link costs the customer one order and never a person, and that still
holds, because the name is what identifies a person and the name is never shown.
Four digits of a number, and that its owner is gold at one outlet, let the
customer confirm the receipt is theirs; they do not tell a stranger who that is.

#54 also declined the four digits so that they could one day serve as a second
factor. That option is spent: no check SHALL be built on the last four digits,
because every receipt prints them. The name was proposed for the receipt a second
time, and refused, because receipts are now sent to numbers keyed at a counter,
and a name would turn every wrong digit into the disclosure of a person.

#### Scenario: A bill carrying a name and a phone, with a customer attached

- **WHEN** a bill whose customer gave the number ending 0042 is served as a receipt
- **THEN** the page, its counter view and the PDF show the last four digits, 0042
- **AND** neither the name nor any other digit of the number appears anywhere in
  the payload, the page or the PDF

#### Scenario: A gold member's bill

- **WHEN** a bill rung while its customer was gold at the bill's outlet is served
- **THEN** the receipt says the customer was gold at that outlet

#### Scenario: Gold ended after the sale

- **WHEN** that customer's gold is revoked, or expires, and the receipt is opened
  again
- **THEN** it still says the customer was gold at that outlet

#### Scenario: A bill with no customer attached

- **WHEN** a bill rung without a number, or a bill rung before customers were
  identified that carries a typed name and phone but no customer, is served
- **THEN** the receipt shows no digits and no gold mark

#### Scenario: A link reaches the wrong person

- **WHEN** a link is opened by somebody other than the customer it was meant for
- **THEN** what they can learn is one order, the last four digits of a number and
  whether its owner was gold at that outlet, and nothing that names any person

## ADDED Requirements

### Requirement: The receipt says how the bill was served

The receipt SHALL say whether a bill was dine-in or takeaway when the bill recorded
it, read from the bill's own stored value, beside the bill number.

The receipt SHALL NOT show a table number, and the reader SHALL NOT return one. A
table is a label for the length of a meal, like the day's order number, which the
receipt does not show either [owner, 2026-09-30].

A bill that recorded neither SHALL say nothing about how it was served.

#### Scenario: A dine-in bill at a table

- **WHEN** a bill recorded as dine-in at table 4 is served
- **THEN** the page, its counter view and the PDF say *Dine-in*, and no table
  appears anywhere in the payload or on the receipt

#### Scenario: A takeaway bill

- **WHEN** a bill recorded as takeaway is served
- **THEN** the receipt says takeaway

#### Scenario: A bill from before the choice existed

- **WHEN** a bill that recorded no service type is served
- **THEN** the receipt says nothing about how it was served
