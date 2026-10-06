# Customer Membership

## Purpose

Business-wide customer membership as a hand-granted label only: an append-only
record of grants and revocations, snapshotted onto every order and bill, shown to
the counter as a mark and nothing else, and read by the owner with recent activity
derived rather than stored.

## Requirements

### Requirement: Membership is business-wide, and it is a label

A customer's membership SHALL apply across the whole business, not per outlet, so
that one person holds one membership however many outlets the business trades
from.

Membership SHALL confer no automatic price change, with **one exception an outlet
may choose**: an outlet that waives packaging for gold members SHALL charge a
member nothing for packaging. No other discount, benefit or charge SHALL be
computed from membership. Anything else a member is given SHALL be decided by the
person serving them, using the discount controls that already exist.

#### Scenario: A member is recognised anywhere

- **WHEN** a member is identified at any outlet
- **THEN** the same membership is in force, with no outlet qualification

#### Scenario: Membership changes no total

- **WHEN** an order is rung for a member with no discount applied by hand, at an outlet that does not waive packaging for gold members
- **THEN** its subtotal, discount and total are identical to the same order rung for a non-member

#### Scenario: The one exception

- **WHEN** a takeaway order is rung for a member at an outlet that waives packaging for gold members
- **THEN** it differs from the same order for a non-member only by the packaging line's waiver

### Requirement: Membership is a record of grants and revocations, never a flag

Membership SHALL be stored as dated records carrying who granted or revoked it and
when. A revocation SHALL be recorded as its own fact and SHALL NOT erase the grant
it ends.

A customer's current membership SHALL be derived from those records rather than
stored as a state that has forgotten how it was reached.

A customer who is granted membership again after a revocation SHALL be reported as
a member since the most recent grant, and the earlier period SHALL remain in the
record.

#### Scenario: Membership is taken back
- **WHEN** an owner revokes a membership
- **THEN** the revocation is recorded with its actor and time, and the grant it ends remains readable

#### Scenario: A member returns
- **WHEN** a customer is granted membership again after a revocation
- **THEN** they are reported as a member since the newest grant, and the earlier spell is still recorded

#### Scenario: History is not a surface
- **WHEN** any screen presents a customer's membership
- **THEN** it presents the current state and the date it began, and no earlier spell is displayed

### Requirement: An order and a bill snapshot the membership they were rung under

An order and a bill SHALL record the customer's membership **as it stood at the
moment of sale**, in the same way a line snapshots its unit price. The server
SHALL determine it from the membership history at the instant the sale was rung,
whenever the sale reaches it; no client SHALL be able to set it.

> Replaces a narrower rule the design first carried, under which a sale rung
> offline for a member the tablet had never seen, and paid on the spot, recorded
> no membership because the counter did not know. Honouring that required the
> tablet to send what it knew, which meant a new command version at the money
> boundary. The owner chose the moment-of-sale rule on 2026-09-24, knowing the one
> case it changes is rare.

A bill that settles an order SHALL carry that order's membership. A revision of an
open order that names the same customer SHALL keep the membership the order was
rung under; one that names a different customer SHALL take that customer's.

Every surface presenting a member mark against an order or a bill SHALL read that
snapshot and SHALL NOT consult the live membership.

#### Scenario: Membership is revoked mid-shift
- **WHEN** a customer's membership is revoked after their order was created
- **THEN** that order and the bill it becomes still read as a member's, because that is what was true when it was rung

#### Scenario: A bill is read a year later
- **WHEN** a settled bill is opened long after the membership that produced it ended
- **THEN** it still reports the membership it was rung under, with no membership record consulted

#### Scenario: The counter is offline and knows the customer
- **WHEN** an order is rung for a member the tablet already holds while the network is unreachable
- **THEN** the mark is available from what the tablet holds, and the sale does not wait on a membership read

#### Scenario: An offline sale reaches the server hours later
- **WHEN** a sale rung offline for a customer who was a member at that moment reaches the server after the membership has ended
- **THEN** it records the membership as it stood when it was rung, and a sale rung before a grant records none

#### Scenario: A revision keeps the order's membership
- **WHEN** an open order is revised after its customer's membership was revoked, still naming that customer
- **THEN** the order keeps the membership it was rung under, so a card mid-preparation does not lose its mark

#### Scenario: A client names a membership
- **WHEN** any write to an order or a bill attempts to set its membership directly
- **THEN** the write is refused or overruled, and the recorded membership is the one the history gives

### Requirement: The owner grants or revokes membership, and a manager only for a customer wholly theirs

An active Super Admin SHALL be able to grant and revoke membership through the
management customer path for any customer. A Franchise Admin SHALL be able to do
the same **only for a customer every one of whose orders and bills belongs to an
outlet that Franchise Admin's assignments name**, and SHALL be refused for any
customer served anywhere else, that condition being evaluated at the moment of
the write. A Biller, Employee, counter device or machine principal SHALL be
refused, including by a hand-crafted request carrying a valid session.

A grant or revocation SHALL record the person who made it.

Granting and revoking SHALL each be confirmed before they take effect, and SHALL
be confirmed in the same way as each other.

#### Scenario: A counter role attempts a grant
- **WHEN** a Biller, Employee or counter device calls the grant or revoke path with a valid session
- **THEN** the request is refused and no membership record is written

#### Scenario: A manager changes a customer only their outlet serves
- **WHEN** a Franchise Admin grants or revokes for a customer served only at outlets they manage
- **THEN** the record is written with them as its actor

#### Scenario: A manager tries to change a shared customer
- **WHEN** a Franchise Admin grants, revokes or renames a customer who has been served at any outlet they do not manage
- **THEN** the request is refused and nothing is written

#### Scenario: A customer visits a second outlet
- **WHEN** a customer only one manager's outlet had served is served at another outlet, and that manager then tries to change them
- **THEN** the request is refused, however recently the manager's card was read

#### Scenario: The owner changes a membership
- **WHEN** an active Super Admin grants or revokes and confirms
- **THEN** the record is written with them as its actor

#### Scenario: The owner changes their mind at the confirmation
- **WHEN** an active Super Admin opens the confirmation and dismisses it
- **THEN** nothing is written and the membership is as it was

### Requirement: The counter is told membership and nothing else

A billing context SHALL learn whether an identified customer is a member, and
SHALL NOT learn when the membership began, who granted it, whether it was ever
revoked, or anything about that customer's spending or visits.

The mark SHALL appear beside the identified customer on the composer, on the
match and on the partial-number suggestion inside the customer dialog, on the
order's card in the preparation pipeline, on the open-order card and on the shift
bill list, so that an order for a member can be recognised while it is being
prepared and not only while it is being rung.

The same mark SHALL appear on an order's and a bill's detail in Billing history
for the roles that already read that history, read from the order's or bill's own
snapshot. It SHALL NOT be accompanied there by any date, actor or figure either.

#### Scenario: A member is identified at the till
- **WHEN** a biller identifies a customer who is a member
- **THEN** the mark is shown, and no date, actor, history or figure accompanies it

#### Scenario: A member surfaces from a partial number
- **WHEN** a partial number suggests a customer this outlet has served who is a member
- **THEN** the suggestion carries the mark, and nothing else about their membership

#### Scenario: A member's bill is read in Billing history
- **WHEN** a manager or the owner opens a bill that was rung for a member
- **THEN** its detail carries the mark from the bill's own snapshot, with no date, actor or figure

#### Scenario: The kitchen sees the order
- **WHEN** an order for a member reaches the preparation pipeline
- **THEN** its card carries the same mark the composer carried

#### Scenario: The till asks for more
- **WHEN** a billing context requests membership detail beyond the mark
- **THEN** no such path exists and nothing further is disclosed

### Requirement: The owner reads a customer's recent activity, derived and never stored

The owner-authorised customer path SHALL report, for one customer, how many bills
they have paid and what they have spent **in the last thirty days**, together with
when they were last seen and when they first became a customer.

One bill SHALL count as one visit. Voided bills SHALL be excluded from both the
count and the amount.

These figures SHALL be derived at read time from bills, under the reader's own
authority. They SHALL NOT be stored on the customer record, and no aggregate of a
customer's activity SHALL be added to it.

No billing context SHALL be able to read these figures.

A Franchise Admin SHALL read the same figures for a customer their outlets have
served, **counted only from bills at the outlets their assignments name**, and
with the customer's first sale at those outlets in place of the date they first
became a customer anywhere.

#### Scenario: A regular is assessed
- **WHEN** an active Super Admin opens a customer who has paid several bills this month
- **THEN** the count, the amount, the last-seen date and the customer-since date are reported

#### Scenario: A customer who stopped coming
- **WHEN** a customer's bills are all older than thirty days
- **THEN** the thirty-day figures report nothing, while last seen and customer since still report

#### Scenario: A bill is voided
- **WHEN** a bill within the window is voided
- **THEN** it counts as neither a visit nor spend

#### Scenario: Nothing is cached onto the customer
- **WHEN** the figures are read
- **THEN** the customer record is unchanged and carries no visit or spend column

### Requirement: The owner finds a customer by name, by number or from two lists, and corrects a name in place

The owner-authorised customer path SHALL retrieve customers by any part of their
saved name of three or more characters, ignoring case, or by three or more
digits appearing anywhere in their number. Where fewer than twenty names contain the
query, customers whose name contains its characters in order with gaps between
them SHALL fill the remainder, ranked after every exact match; a number SHALL
only ever match as one unbroken run. It SHALL return at most twenty customers,
exact matches first and each kind most recently seen first, together with a count
of any further matches and nothing else about them. A shorter query SHALL return no customers. It SHALL also
present, without requiring a search, two lists: every customer seen in the last
thirty days, ranked by their visits in that window with each one's visit count;
and every customer currently holding a membership, newest grant first. Each list
SHALL be delivered in pages of twenty in a total order, so consecutive pages
neither repeat nor omit a customer while the list is unchanged. The visit ranking SHALL be derived at read time from bills
under the same rules as the per-customer figures, and SHALL NOT be stored.

A Franchise Admin SHALL have the same search and lists over only the customers
the outlets their assignments name have served, ranked from those outlets' bills
alone. A customer no outlet of theirs has served SHALL be indistinguishable, to
them, from one who does not exist.

No billing context or device SHALL have either list, the search, or any other list
of customers.

An active Super Admin SHALL be able to correct any customer's saved name, and a
Franchise Admin that of a customer wholly theirs under the same condition as a
membership change. A correction SHALL change the saved profile only; bills and orders already
snapshotted SHALL be unchanged by it. A saved name SHALL NOT be corrected to
nothing.

A customer SHALL be presented for reading and editing without their identity
appearing in an address.

#### Scenario: The owner looks somebody up by name
- **WHEN** an active Super Admin searches with part of a customer's saved name, in any case
- **THEN** that customer is among the results

#### Scenario: The owner remembers only part of a number
- **WHEN** an active Super Admin searches with three or more digits that appear in a customer's number
- **THEN** that customer is among the results

#### Scenario: A name is half-remembered
- **WHEN** an active Super Admin searches with letters that appear in a customer's name in order but not together
- **THEN** that customer is among the results, after every customer whose name contains the query exactly

#### Scenario: A search matches many
- **WHEN** more than twenty customers match
- **THEN** twenty are returned, most recently seen first, with a count of the rest and no way to page past them

#### Scenario: A query is too short
- **WHEN** fewer than three letters or three digits are supplied
- **THEN** no customer is returned

#### Scenario: The owner finds a regular without their number
- **WHEN** an active Super Admin opens the customer surface
- **THEN** everybody seen in the last thirty days is listed, most visits first and one visit included, each with their visit count, and the current members are one step away, with no search entered

#### Scenario: The lists grow long
- **WHEN** a list holds more than twenty customers
- **THEN** it is delivered twenty at a time, and every customer appears exactly once across the pages

#### Scenario: A manager looks for another outlet's customer
- **WHEN** a Franchise Admin searches for, lists, or opens by id a customer only another outlet has served
- **THEN** that customer is not returned, exactly as though they did not exist

#### Scenario: A manager reads a shared customer
- **WHEN** a Franchise Admin opens a customer their outlet and another outlet have both served
- **THEN** visits and spend count only their outlets' bills, and the card offers no change to the name or the membership

#### Scenario: A list is asked for from the counter
- **WHEN** a billing context requests either list or the owner's search
- **THEN** the request is refused and no customer is disclosed

#### Scenario: A name is cleared
- **WHEN** an active Super Admin attempts to correct a saved name to an empty one
- **THEN** the correction is refused and the saved name is unchanged

#### Scenario: A misspelt name is corrected
- **WHEN** an active Super Admin corrects a customer's name
- **THEN** the saved profile changes and every existing bill and order still reports the name it snapshotted

#### Scenario: A customer is opened
- **WHEN** an active Super Admin opens a customer from a search or from either list
- **THEN** their details are presented without a navigable address identifying them

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
