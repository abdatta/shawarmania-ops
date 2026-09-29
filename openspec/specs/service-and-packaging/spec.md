# Service and Packaging

## Purpose

How each outlet chooses to serve: whether its orders are marked dine-in or
takeaway, whether dine-in orders take a keyed table number, and whether a
packaging charge is added per bag or per order, optionally free for gold members.
Every switch starts off, so a new outlet bills exactly as before, and the counter
asks only where the outlet has left a choice.

## Requirements

### Requirement: An outlet chooses how it serves, and starts with nothing chosen

Each outlet SHALL carry its own choices of: whether orders are marked dine-in,
takeaway, or both; whether dine-in orders take a table number; whether a packaging charge is added to takeaway orders, as a
flat amount per order or per bag, and at what price; and whether packaging is
free for gold members.

An outlet SHALL start with no order types offered, no table numbers and no
packaging charge, and SHALL then bill exactly as an outlet did before these choices existed.

The database SHALL refuse an inconsistent combination: table numbers without
dine-in offered, a packaging charge without takeaway offered, a packaging price
without a packaging charge, a packaging price that is not a whole number of
rupees of at least ₹1, or a gold waiver without a packaging charge. There SHALL be
no upper limit on the packaging price.

#### Scenario: A new outlet

- **WHEN** an outlet is created
- **THEN** it offers no order type, no table numbers and no packaging charge, and its counter shows none of them

#### Scenario: An inconsistent write

- **WHEN** a request turns table numbers on at an outlet that does not offer dine-in
- **THEN** the database refuses it

### Requirement: The settings page grows only with what is switched on

The outlet's page SHALL show one switch for order types. The settings belonging
to a switch SHALL be shown only while that switch is on, **inside** that switch's
own area: the table-numbers switch while dine-in is offered, and the packaging charge
while takeaway is offered.

Turning order types on SHALL offer both types by default. Turning it off SHALL
clear both types, table numbers and the packaging charge. Ceasing to offer
takeaway SHALL clear the packaging charge. Turning the packaging charge on SHALL
start at a flat amount per order.

#### Scenario: A newcomer's page

- **WHEN** the owner opens the page of an outlet with nothing chosen
- **THEN** the page shows one switch, and nothing beneath it

#### Scenario: Turning packaging on

- **WHEN** the owner offers takeaway and turns its packaging charge on
- **THEN** the choice of flat per order or per bag, with flat chosen, the price, and the gold waiver appear inside it

#### Scenario: Takeaway is no longer offered

- **WHEN** the owner stops offering takeaway at an outlet charging for packaging
- **THEN** the packaging charge is cleared with it

### Requirement: The owner and the outlet's own managers change how it serves

The owner SHALL be able to change any outlet's service choices, and a Franchise
Admin SHALL be able to change those of the outlets they manage. Every other
principal — a Franchise Admin of another outlet, a Biller, an Employee and a
counter device — SHALL be refused by the database, however the request is made.

Allowing a manager to write these choices SHALL NOT allow them to write any other
column of the outlet row, which the owner alone changes.

#### Scenario: A manager changes their own outlet

- **WHEN** a Franchise Admin sets their own outlet's packaging price
- **THEN** it is stored

#### Scenario: A manager's hand-crafted write elsewhere

- **WHEN** a Franchise Admin sends a valid-session request setting another outlet's packaging price
- **THEN** the database refuses it and nothing changes

#### Scenario: A manager reaches past the service choices

- **WHEN** a Franchise Admin sends a valid-session request changing their own outlet's business-day cutover
- **THEN** the database refuses it and nothing changes

### Requirement: The counter asks where the food goes only where there is a choice, and the answer is owed

The counter SHALL ask where the food goes, as one tap per offered type, exactly
where there is a choice: at an outlet offering both types, and at an outlet
offering dine-in with tables. It SHALL preselect nothing there, and the order
SHALL NOT be saved or paid until the biller has answered: a type, and for
dine-in with tables, a table or no table. An answer SHALL be changeable, and the
biller SHALL be able to take it back by choosing the same type again, which
leaves the order unanswered and SHALL again hold saving and payment.

At an outlet offering exactly one type with nothing to choose within it, the
counter SHALL show no choice, and every order SHALL be that type: takeaway at
an outlet offering takeaway alone, and dine-in without a table at an outlet
offering dine-in alone without tables.

The counter SHALL leave an order neither only at an outlet offering no type.
An order MAY still record neither where a tablet rang it before the outlet began
offering types, and every order rung before these choices existed reads as
neither.

#### Scenario: Both types offered

- **WHEN** a biller at an outlet offering both types adds items and identifies the customer without marking the order
- **THEN** it cannot be saved or paid until dine-in or takeaway is chosen

#### Scenario: Takeaway alone

- **WHEN** a biller at an outlet offering only takeaway starts an order
- **THEN** no choice is shown and the order is takeaway

#### Scenario: Dine-in alone, with tables

- **WHEN** a biller at an outlet offering only dine-in, with tables, starts an order
- **THEN** the order cannot be saved or paid until a table or no table is chosen

### Requirement: A dine-in order takes a keyed table, and a busy table is refused

At an outlet with table numbers, marking an order dine-in SHALL open a number pad
on which the biller keys the table: one to three digits, 1 to 999, with no
decimal point, no `00` and no leading nought. The outlet SHALL keep no count of
its tables. A table SHALL be busy while an open order at the outlet, as far as
the tablet can see, carries it. Keying a busy table SHALL be refused, shown in
red with the reason, and the order SHALL NOT take it; an order being edited
SHALL never be refused its own table.

A table SHALL free when its order is paid or cancelled.

The biller SHALL answer with a table or with no table. A dine-in order without
one SHALL be called by its order number.

The database SHALL NOT refuse a second open order carrying the same table.

#### Scenario: A table already open

- **WHEN** a biller keys table 4 for a new order while table 4 holds an open order
- **THEN** the pad shows 4 in red, says Table 4 is already open, offers a way to edit that order, and Done stays disabled

#### Scenario: Going to the open table's order

- **WHEN** the biller, refused table 4, takes the refusal's way to its order
- **THEN** table 4's order opens for editing exactly as its own Edit would open it, and the bill that was in progress is kept and returns when the edit ends

#### Scenario: Any number

- **WHEN** a biller keys 120 at an outlet that has never said how many tables it has
- **THEN** the order takes table 120

#### Scenario: A table frees on payment

- **WHEN** table 4's order is paid
- **THEN** table 4 is no longer busy, and the paid order's pipeline card still reads Table 4

#### Scenario: Two tablets seated one table offline

- **WHEN** two orders for table 4 reach the server from tablets that could not see each other
- **THEN** both are recorded, and the pipeline shows both as Table 4, each marked 1 of 2 or 2 of 2, oldest first

#### Scenario: A payment taken back after the table was seated again

- **WHEN** a paid table-4 order is reopened by taking its payment back while another order is open at table 4
- **THEN** both stay open at table 4 and each card says which of the two it is, until one is paid or cancelled

### Requirement: Packaging is a line added to every takeaway order

At an outlet with a packaging charge, every order marked takeaway SHALL carry one
packaging line named *Packaging*, added automatically, and no other order SHALL.
Per bag, it SHALL start at one bag at the outlet's price per bag and change by
the line's own quantity controls. Flat, it SHALL be one line at the outlet's
amount.

The biller SHALL NOT be able to remove it or change its price. Per bag, the
biller SHALL be able to change the number of bags, down to one. Marking the
order dine-in SHALL remove it, and marking it takeaway SHALL add it.

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
that line's discount. Changing the customer on an open order, or skipping them,
SHALL re-derive the waiver. Once the order is paid, the waiver SHALL be fixed.

#### Scenario: A gold member's takeaway

- **WHEN** a biller identifies a gold member on a takeaway order at a waiving outlet
- **THEN** the packaging line reads as free, and the total excludes it

#### Scenario: The customer is skipped instead

- **WHEN** the biller then skips the customer, or identifies somebody who is not gold
- **THEN** the packaging is charged again

### Requirement: The counter serves offline the way its outlet does

An outlet's service choices SHALL be part of what a tablet remembers for a cold
start, and SHALL reach a running tablet at its next menu refresh. An order rung
offline with a type, a table, a packaging line or a waiver SHALL settle exactly
once on reconnect, carrying all of them.

#### Scenario: A cold start with no backend

- **WHEN** a tablet at an outlet with table numbers and packaging is reopened with no network
- **THEN** it offers the same types, table numbers and packaging it offered before

#### Scenario: Offline takeaway for a member

- **WHEN** a takeaway order for a gold member, with two bags waived, is rung offline and the tablet reconnects
- **THEN** one order is recorded with its type, both bags and the waiver, exactly once
