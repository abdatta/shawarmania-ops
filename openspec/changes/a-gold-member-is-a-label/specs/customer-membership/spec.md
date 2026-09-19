## ADDED Requirements

### Requirement: Membership is business-wide, and it is a label

A customer's membership SHALL apply across the whole business, not per outlet, so
that one person holds one membership however many outlets the business trades
from.

Membership SHALL confer no automatic price change. No discount, no benefit and no
charge SHALL be computed from it. What a member is given SHALL be decided by the
person serving them, using the discount controls that already exist.

#### Scenario: A member is recognised anywhere
- **WHEN** a member is identified at any outlet
- **THEN** the same membership is in force, with no outlet qualification

#### Scenario: Membership changes no total
- **WHEN** an order is rung for a member with no discount applied by hand
- **THEN** its subtotal, discount and total are identical to the same order rung for a non-member

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

An order and a bill SHALL record the customer's membership as it stood when the
order was created, in the same way a line snapshots its unit price.

Every surface presenting a member mark against an order or a bill SHALL read that
snapshot and SHALL NOT consult the live membership.

Where a tablet could not know a customer's membership at the moment of sale, the
recorded membership SHALL be resolved when the sale reaches the server **while it
is still an open order**, so that an order still to be prepared is treated as the
member's order it is. Once a sale has become a bill its recorded membership SHALL
be final, and SHALL NOT be resolved, corrected or backfilled.

#### Scenario: Membership is revoked mid-shift
- **WHEN** a customer's membership is revoked after their order was created
- **THEN** that order and the bill it becomes still read as a member's, because that is what was true when it was rung

#### Scenario: A bill is read a year later
- **WHEN** a settled bill is opened long after the membership that produced it ended
- **THEN** it still reports the membership it was rung under, with no membership record consulted

#### Scenario: The counter is offline and knows the customer
- **WHEN** an order is rung for a member the tablet already holds while the network is unreachable
- **THEN** the mark is available from what the tablet holds, and the sale does not wait on a membership read

#### Scenario: An offline order for an unknown member arrives while still open
- **WHEN** an order rung offline against a member the tablet had never seen reaches the server and has not been paid
- **THEN** its recorded membership is resolved, and the mark appears on its card in the preparation pipeline

#### Scenario: An offline sale for an unknown member arrives already paid
- **WHEN** a sale rung and paid offline against a member the tablet had never seen reaches the server
- **THEN** it is recorded without membership, because a bill states what the counter knew and did

### Requirement: Only the owner grants or revokes membership

An active Super Admin SHALL be able to grant and revoke membership through the
owner-authorised customer path. A Franchise Admin, Biller, Employee, counter
device or machine principal SHALL be refused, including by a hand-crafted request
carrying a valid session.

Granting and revoking SHALL each be confirmed before they take effect, and SHALL
be confirmed in the same way as each other.

#### Scenario: An outlet role attempts a grant
- **WHEN** a Franchise Admin, Biller or Employee calls the grant or revoke path with a valid session
- **THEN** the request is refused and no membership record is written

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
order's card in the preparation pipeline, on the open-order card and on the shift
bill list, so that an order for a member can be recognised while it is being
prepared and not only while it is being rung.

#### Scenario: A member is identified at the till
- **WHEN** a biller identifies a customer who is a member
- **THEN** the mark is shown, and no date, actor, history or figure accompanies it

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

No outlet role SHALL be able to read these figures through the billing path.

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

### Requirement: The owner finds a customer by complete phone, and corrects a name in place

The owner-authorised customer path SHALL retrieve a customer by their complete
phone number, and SHALL present recently created customers without requiring a
search.

An active Super Admin SHALL be able to correct a customer's saved name. A
correction SHALL change the saved profile only; bills and orders already
snapshotted SHALL be unchanged by it.

A customer SHALL be presented for reading and editing without their identity
appearing in an address.

#### Scenario: The owner looks somebody up
- **WHEN** an active Super Admin supplies a complete phone that exists
- **THEN** that customer is presented

#### Scenario: A misspelt name is corrected
- **WHEN** an active Super Admin corrects a customer's name
- **THEN** the saved profile changes and every existing bill and order still reports the name it snapshotted

#### Scenario: A customer is opened
- **WHEN** an active Super Admin opens a customer from the results
- **THEN** their details are presented without a navigable address identifying them
