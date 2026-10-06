## ADDED Requirements

### Requirement: The owner reads a customer's bills at an outlet on their card

A customer's card SHALL offer, for the outlet it is read for, every bill that
outlet has rung for them, newest first by the moment paid and then the bill's
identity, in pages in that total order.

The list SHALL be read only when the reader asks for it, never when the card
opens, and SHALL carry for each bill only what its summary row shows: the bill
number, whether it was paid or cancelled and how, when it was paid, who rang it
and on which till, and its total. A bill's items, payments, customer and
timeline SHALL be read only when its row is opened, and the row SHALL then show
the same summary and the same detail as Billing.

The list SHALL be read under the reader's own authority over that outlet's
bills, and SHALL disclose nothing the reader could not already read in Billing.
A Franchise Admin SHALL have the same list only at the outlets their assignments
name. No billing context or device SHALL have it.

On the card, the list SHALL occupy a fixed-height region that scrolls on its own,
and the card SHALL NOT grow taller than the viewport less a margin.

#### Scenario: The card is only opened
- **WHEN** a customer's card is opened and the bills are not asked for
- **THEN** no bill is read

#### Scenario: The owner reads a regular's history
- **WHEN** an active Super Admin asks for a customer's bills on their card
- **THEN** the outlet's bills for that customer are listed newest first as Billing's summary rows, and no bill's items, payments or customer are read

#### Scenario: A bill is opened
- **WHEN** the reader opens one of those rows
- **THEN** that bill alone is read in full and shows Billing's detail

#### Scenario: A cancelled bill
- **WHEN** one of the customer's bills at the outlet was cancelled
- **THEN** it is listed and marked cancelled

#### Scenario: A long history
- **WHEN** a customer has more bills at the outlet than one page holds
- **THEN** further pages are read only as the region is scrolled near its end, and every bill appears exactly once

#### Scenario: A manager asks about another outlet
- **WHEN** a Franchise Admin asks for a customer's bills at an outlet their assignments do not name
- **THEN** no bill is returned
