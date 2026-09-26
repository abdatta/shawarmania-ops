## ADDED Requirements

### Requirement: An outlet chooses how it serves, and starts with nothing chosen

Each outlet SHALL carry its own choices of: whether orders are marked dine-in,
takeaway, or both; whether an order may be neither; whether dine-in orders take a
table number, and how many tables there are; whether a packaging charge is added,
per bag or as a flat amount per order, and at what price; and whether packaging
is free for gold members.

An outlet SHALL start with no order types offered, no tables and no packaging
charge, and SHALL then bill exactly as an outlet did before these choices existed.

The database SHALL refuse an inconsistent combination: a table count without
dine-in offered, a packaging price without a packaging charge, a packaging price
that is not a whole number of rupees from ₹1 to ₹500, or a gold waiver without a
packaging charge.

#### Scenario: A new outlet

- **WHEN** an outlet is created
- **THEN** it offers no order type, no tables and no packaging charge, and its counter shows none of them

#### Scenario: An inconsistent write

- **WHEN** a request sets a table count on an outlet that does not offer dine-in
- **THEN** the database refuses it

### Requirement: The settings page grows only with what is switched on

The outlet's page SHALL show one switch for order types and one for packaging.
The settings under a switch SHALL be shown only while that switch is on, and the
table count only while dine-in is offered with tables on.

Turning order types on SHALL offer both types by default. Turning it off SHALL
clear both types and the table count.

#### Scenario: A newcomer's page

- **WHEN** the owner opens the page of an outlet with nothing chosen
- **THEN** the two sections each show one switch, and nothing beneath them

#### Scenario: Turning packaging on

- **WHEN** the owner turns the packaging charge on
- **THEN** the choice of per bag or flat, the price, and the gold waiver appear beneath it

### Requirement: Only the owner changes how an outlet serves

The owner alone SHALL change an outlet's service choices. Every other principal,
including a Franchise Admin of that outlet and a counter device, SHALL be refused
by the database, however the request is made.

A Franchise Admin SHALL see the service choices of the outlets they manage,
read-only, and SHALL see no other outlet's.

#### Scenario: A manager reads their own outlet's choices

- **WHEN** a Franchise Admin opens the page of an outlet they manage
- **THEN** its order and packaging choices are shown with their current answers and no control to change them

#### Scenario: A manager's hand-crafted write

- **WHEN** a Franchise Admin sends a valid-session request setting their own outlet's packaging price
- **THEN** the database refuses it and nothing changes

### Requirement: An order is marked dine-in or takeaway, or neither where the outlet allows

At an outlet offering order types, the counter SHALL offer each offered type as
one tap. Where the outlet allows an order to be neither, no type SHALL need to be
chosen, and the chosen type SHALL be clearable. Where it does not, the order SHALL
start on the first offered type.

Marking an order SHALL never block saving or payment.

#### Scenario: Skipping is allowed

- **WHEN** a biller at an outlet allowing neither saves an order without marking it
- **THEN** the order is saved as neither

#### Scenario: Skipping is not allowed

- **WHEN** a biller at an outlet not allowing neither starts an order
- **THEN** the order is already marked with the first offered type

### Requirement: A dine-in order takes a table, and a busy table opens its order

At an outlet with tables, marking an order dine-in SHALL open a popup offering
the table numbers from one to the outlet's count. A table SHALL be shown busy while an open order at
the outlet, as far as the tablet can see, carries it. Choosing a busy table SHALL
open that order to add to it when this tablet owns it, and SHALL otherwise say
the table is open on another tablet.

A table SHALL free when its order is paid or cancelled.

Choosing a table SHALL be optional. A dine-in order without one SHALL be called by
its order number.

The database SHALL NOT refuse a second open order carrying the same table.

#### Scenario: More food for table 4

- **WHEN** a biller marks a new order dine-in and taps table 4, which holds an open order this tablet owns
- **THEN** that open order opens for editing, and no second order is started

#### Scenario: A table frees on payment

- **WHEN** table 4's order is paid
- **THEN** table 4 is no longer busy, and the paid order's pipeline card still reads Table 4

#### Scenario: Two tablets seated one table offline

- **WHEN** two orders for table 4 reach the server from tablets that could not see each other
- **THEN** both are recorded, and the pipeline shows both as Table 4

### Requirement: Packaging is a line added to every order that is not dine-in

At an outlet with a packaging charge, every order not marked dine-in SHALL carry
one packaging line named *Packaging*, added automatically. Per bag, it SHALL start at one bag at
the outlet's price per bag and change by the line's own quantity controls. Flat,
it SHALL be one line at the outlet's amount.

The biller SHALL be able to remove it. Marking the order dine-in SHALL remove it,
and marking it takeaway SHALL add it.

A packaging line SHALL snapshot its name and price like every line, SHALL be
recorded as packaging rather than as a menu item, and SHALL NOT be reached by any
menu discount.

#### Scenario: A takeaway order

- **WHEN** a biller marks an order takeaway at an outlet charging ₹5 per bag
- **THEN** a packaging line of one bag at ₹5 is on the bill, last among its lines

#### Scenario: The price changes while an order is open

- **WHEN** the owner changes the bag price after a packaging line is on an open order
- **THEN** that line keeps its captured price

### Requirement: Packaging is free for a gold member where the outlet says so

At an outlet waiving packaging for gold members, an order whose customer the
tablet knows to be a gold member SHALL carry its packaging line's whole amount as
that line's discount. Changing or clearing the customer on an open order SHALL
re-derive the waiver. Once the order is paid, the waiver SHALL be fixed.

#### Scenario: A gold member's takeaway

- **WHEN** a biller identifies a gold member on a takeaway order at a waiving outlet
- **THEN** the packaging line reads as free, and the total excludes it

#### Scenario: The customer is cleared

- **WHEN** the biller then clears the customer
- **THEN** the packaging is charged again

### Requirement: The counter serves offline the way its outlet does

An outlet's service choices SHALL be part of what a tablet remembers for a cold
start, and SHALL reach a running tablet at its next menu refresh. An order rung
offline with a type, a table, a packaging line or a waiver SHALL settle exactly
once on reconnect, carrying all of them.

#### Scenario: A cold start with no backend

- **WHEN** a tablet at an outlet with tables and packaging is reopened with no network
- **THEN** it offers the same types, tables and packaging it offered before

#### Scenario: Offline takeaway for a member

- **WHEN** a takeaway order for a gold member, with two bags waived, is rung offline and the tablet reconnects
- **THEN** one order is recorded with its type, both bags and the waiver, exactly once
