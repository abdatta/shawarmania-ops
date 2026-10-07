## REMOVED Requirements

### Requirement: Membership is business-wide, and it is a label

**Reason**: Membership now belongs to one outlet and carries benefits that outlet
chose: a higher points cap, optionally its own earn rate, and #60's packaging
waiver. #57 made it business-wide because it was a label, because the business
has one trading outlet, and because adding an outlet later was cheap. The owner
reversed that on 2026-09-28, when gold gained per-outlet rules and a franchisee
would otherwise fund a benefit another shop granted. Production held no
memberships, so nothing was converted.

**Migration**: Replaced by *Membership belongs to an outlet, and carries what that
outlet grants*.

### Requirement: The owner grants or revokes membership, and a manager only for a customer wholly theirs

**Reason**: A manager's "wholly theirs" condition existed only because a grant
reached every outlet. A grant now reaches one, so a manager may change gold for
any customer their outlet served, and a biller may grant to an eligible customer
at the counter.

**Migration**: Replaced by *The owner and the outlet's managers grant and revoke
membership there, and a biller grants only to the eligible*. The whole-history
condition survives for renaming, in *The owner finds a customer*.

### Requirement: The counter is told membership and nothing else

**Reason**: The counter is now also told the customer's points balance and whether
they are eligible for gold, both at its own outlet.

**Migration**: Replaced by *The counter is told membership, balance and
eligibility at its own outlet, and nothing else*.

## ADDED Requirements

### Requirement: Membership belongs to an outlet, and carries what that outlet grants

A customer's membership SHALL be held at one outlet and SHALL be in force only
there. One person MAY be a member at one outlet and not at another.

Membership SHALL change a total only through what its outlet has chosen: the
gold points cap, a gold earn rate if the outlet set one, and the packaging waiver.
No other discount, benefit or charge SHALL be computed from it.

#### Scenario: A member at a second outlet
- **WHEN** a member of one outlet is identified at another
- **THEN** they are not a member there, and nothing of the first outlet's membership is disclosed

#### Scenario: Membership changes no other total
- **WHEN** an order is rung for a member with no points used and no packaging, at an outlet whose earn rate is the same for gold
- **THEN** its subtotal, discount and total are identical to the same order for a non-member

### Requirement: Every gold setting is also shown under Gold members, as one value

Every outlet setting that applies only to gold members SHALL be shown in its own
section of the outlet's page and again under that outlet's Gold members, and the
two SHALL be one value: a change made to either SHALL show at once in the other,
and saving from the Gold members section SHALL save it whichever section it
belongs to. While the outlet has gold off, neither copy SHALL be shown.

A setting that applies only to gold members, added by any later change, SHALL be
added under Gold members in that same change.

> Settled by the owner on 2026-09-29, when free packaging for gold members sat in
> Orders, a section above the Gold members switch, and turning gold on gave no
> sign that it had appeared. The rule is for every later gold setting too, so that
> nobody has to ask for it again.

#### Scenario: Free packaging from the Gold members section
- **WHEN** the owner switches free packaging on under Gold members and saves there
- **THEN** Orders shows it on, and it is stored

#### Scenario: Gold is switched off
- **WHEN** the owner switches gold members off
- **THEN** no gold setting shows in any section, its own or Gold members

### Requirement: A membership ends on the date its grant stored

Every grant SHALL store the date it ends, set when it is granted from its outlet's
gold duration, a whole number of months. A later change to that duration SHALL NOT
move the end of any existing grant.

A membership SHALL be in force from its grant until the earlier of its revocation
and its end. A customer SHALL hold at most one membership in force at an outlet at
once. When one ends, a new grant MAY begin.

Every outlet SHALL have a gold duration, six months unless changed, set by the
owner or the outlet's managers.

#### Scenario: Gold lapses
- **WHEN** a membership's stored end passes
- **THEN** the customer is no longer a member there, with nothing written, and a sale afterwards records no membership

#### Scenario: The duration changes
- **WHEN** an outlet shortens its gold duration from six months to three
- **THEN** existing members keep the end dates their grants stored

#### Scenario: A second grant while one is in force
- **WHEN** a grant is attempted for a customer already a member at that outlet
- **THEN** no second membership is written

### Requirement: Eligibility is derived from this outlet's paid bills and disclosed only as yes or no

A customer SHALL be eligible for gold at an outlet when that outlet has gold and
lets billers grant it, the customer is not a member there, and their settled
bills at that outlet, whose business dates fall within the last thirty business
dates counted back from its current business date, total **at least** the
outlet's threshold. What counts
SHALL be each bill's total as paid; voided bills SHALL count for nothing. A bill
SHALL count from the moment the server has it.

Whether an outlet has gold members at all, whether its billers may grant gold,
and its monthly threshold in whole rupees SHALL be that outlet's own settings,
off for every outlet until the owner or the outlet's managers turn them on. The
thirty-day window SHALL NOT be a setting. Where an outlet has gold off, nobody
SHALL be gold there, no grant SHALL be accepted there, and no surface SHALL offer
anything about gold for it.

Eligibility SHALL be derived when asked and SHALL NOT be stored. A billing context
SHALL learn it only as yes or no, and SHALL NOT learn the amount, the visits or
the dates behind it.

#### Scenario: Exactly the threshold
- **WHEN** a customer's bills at an outlet with a ₹2,000 threshold over 30 days total exactly ₹2,000 within the window
- **THEN** they are eligible

#### Scenario: A bill leaves the window
- **WHEN** the oldest bill that made a customer eligible passes out of the window and the rest total less than the threshold
- **THEN** they are no longer eligible

#### Scenario: Spend at another outlet
- **WHEN** a customer's spend reaches the threshold only by counting bills at another outlet
- **THEN** they are not eligible here

### Requirement: The owner and the outlet's managers grant and revoke membership there, and a biller grants only to the eligible

An active Super Admin SHALL be able to grant and revoke membership at any outlet,
for any customer. A Franchise Admin SHALL be able to do the same at the outlets
their assignments name, for any customer those outlets have served. Neither SHALL
need the customer to be eligible.

A Biller or counter device SHALL be able to grant membership **at its own
outlet**, taken from its own authority and never from an argument, **only to a
customer eligible there at the moment of the write**, as decided by the database
and not by the tablet. It SHALL NOT be able to revoke. Every other principal SHALL
be refused, including by a hand-crafted request carrying a valid session.

A grant SHALL record who made it, how (by management or at the counter), and at
the counter which device. Revocation SHALL record who made it. Granting at the
counter SHALL be confirmed before it takes effect. Granting and revoking by
management SHALL each be confirmed in the same way as each other.

#### Scenario: A biller grants to an eligible customer
- **WHEN** a biller confirms Upgrade to Gold for a customer eligible at their outlet
- **THEN** a membership is written at that outlet, recording the operator, the device and that it was granted at the counter

#### Scenario: A biller's hand-crafted grant for an ineligible customer
- **WHEN** a counter device sends a grant for a customer below the threshold
- **THEN** the database refuses it and nothing is written

#### Scenario: A biller tries to revoke
- **WHEN** a Biller or counter device calls the revoke path with a valid session
- **THEN** the request is refused and the membership is unchanged

#### Scenario: A manager changes a customer another outlet also serves
- **WHEN** a Franchise Admin grants gold at their outlet to a customer another outlet has also served
- **THEN** the membership is written at their outlet only

#### Scenario: A manager reaches another outlet
- **WHEN** a Franchise Admin grants or revokes at an outlet they do not manage
- **THEN** the request is refused and nothing is written

#### Scenario: A double tap at the counter
- **WHEN** a counter grant is sent twice for the same customer
- **THEN** one membership exists, and the second call reports the same outcome as the first

### Requirement: The counter is told membership, balance and eligibility at its own outlet, and nothing else

A billing context SHALL learn, for an identified customer and for its own outlet
only, whether they are a member, their points balance, and whether they are
eligible for gold. It SHALL NOT learn when a membership began or ends, who granted
it, whether it was ever revoked, anything about another outlet, or any spend or
visit figure.

The mark SHALL appear beside the identified customer on the composer, on the
match and on the partial-number suggestion inside the customer dialog, on the
order's card in the preparation pipeline, on the open-order card and on the shift
bill list. The balance SHALL appear with the identified customer in the customer
dialog, and the points the bill can take SHALL appear on the control that uses
them. An eligible customer SHALL be marked eligible, with the control to upgrade
them to Gold.

The same mark SHALL appear on an order's and a bill's detail in Billing history
for the roles that already read that history, read from the order's or bill's own
snapshot, with no date, actor or figure.

#### Scenario: A member is identified at the till
- **WHEN** a biller identifies a customer who is a member here
- **THEN** the mark and their balance here are shown, and no date, actor, history or spend accompanies them

#### Scenario: An eligible customer is identified
- **WHEN** a biller identifies a customer eligible here
- **THEN** they are marked eligible and the control to upgrade them to Gold is offered, with no amount beside it

#### Scenario: The till asks for more
- **WHEN** a billing context requests membership, spend or visit detail beyond these three
- **THEN** no such path exists and nothing further is disclosed

## MODIFIED Requirements

### Requirement: An order and a bill snapshot the membership they were rung under

An order and a bill SHALL record the customer's membership **at the order's or
bill's own outlet, as it stood at the moment of sale**, in the same way a line
snapshots its unit price. The server SHALL determine it from that outlet's
membership history at the instant the sale was rung, whenever the sale reaches
it; no client SHALL be able to set it.

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

#### Scenario: Gold at another outlet
- **WHEN** a sale is rung at one outlet for a customer who is a member only at another
- **THEN** it records no membership

### Requirement: The owner reads a customer's recent activity, derived and never stored

The management customer path SHALL report, for one customer **at one outlet the
reader has chosen and may read**, how many bills they have paid and what they have
spent there **in the last thirty days**, when they were last seen there and when
they first bought there, their points balance there, and their membership there
with the date it ends and how and by whom it was given.

One bill SHALL count as one visit. Voided bills SHALL be excluded from both the
count and the amount.

These figures SHALL be derived at read time from bills and points entries, under
the reader's own authority. They SHALL NOT be stored on the customer record, and
no aggregate of a customer's activity SHALL be added to it.

No billing context SHALL be able to read these figures.

An active Super Admin MAY choose any outlet. A Franchise Admin MAY choose only
the outlets their assignments name.

#### Scenario: A regular is assessed
- **WHEN** an active Super Admin opens a customer at an outlet where they have paid several bills this month
- **THEN** the count, the amount, the last-seen date, the first-visit date, the balance and any membership with its end date are reported for that outlet

#### Scenario: A customer who stopped coming
- **WHEN** a customer's bills at the chosen outlet are all older than thirty days
- **THEN** the thirty-day figures report nothing, while last seen and first visit still report

#### Scenario: A bill is voided
- **WHEN** a bill within the window is voided
- **THEN** it counts as neither a visit nor spend

#### Scenario: Nothing is cached onto the customer
- **WHEN** the figures are read
- **THEN** the customer record is unchanged and carries no visit, spend or points column

#### Scenario: A manager chooses another outlet
- **WHEN** a Franchise Admin requests a customer's figures at an outlet they do not manage
- **THEN** nothing is returned

### Requirement: The owner finds a customer by name, by number or from two lists, and corrects a name in place

The management customer path SHALL work **at one outlet the reader has chosen and
may read**, chosen with the remembered outlet selection every outlet-scoped
surface shares.

It SHALL retrieve the customers that outlet has served by any part of their saved
name of three or more characters, ignoring case, or by three or more digits
appearing anywhere in their number. Where fewer than twenty names contain the
query, customers whose name contains its characters in order with gaps between
them SHALL fill the remainder, ranked after every exact match; a number SHALL only
ever match as one unbroken run. It SHALL return at most twenty customers, exact
matches first and each kind most recently seen first, together with a count of any
further matches and nothing else about them. A shorter query SHALL return no
customers.

It SHALL also present, without requiring a search, two lists for that outlet:
every customer seen there in the last thirty days, ranked by their visits in that
window with each one's visit count; and every customer currently a member there,
each with the date their membership ends, ordered either by newest grant or by
recent visits (visits in the last thirty days, then most recent visit) as the
reader chooses. Each list SHALL be delivered in pages of twenty in a total order,
so consecutive pages neither repeat nor omit a customer while the list is
unchanged. Every ranking SHALL be derived at read time and SHALL NOT be stored.

A customer the chosen outlet has not served SHALL be indistinguishable, there,
from one who does not exist.

No billing context or device SHALL have either list, the search, or any other list
of customers.

An active Super Admin SHALL be able to correct any customer's saved name. A
Franchise Admin SHALL be able to correct the name of a customer **every one of
whose orders and bills belongs to an outlet their assignments name**, evaluated at
the moment of the write, because the name is the person's at every outlet. A
correction SHALL change the saved profile only; bills and orders already
snapshotted SHALL be unchanged by it. A saved name SHALL NOT be corrected to
nothing.

A customer SHALL be presented for reading and editing without their identity
appearing in an address.

#### Scenario: The owner looks somebody up by name
- **WHEN** an active Super Admin searches at an outlet with part of the saved name of a customer it served, in any case
- **THEN** that customer is among the results

#### Scenario: The owner remembers only part of a number
- **WHEN** an active Super Admin searches with three or more digits that appear in the number of a customer the outlet served
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
- **WHEN** an active Super Admin opens the customer surface at an outlet
- **THEN** everybody seen there in the last thirty days is listed, most visits first and one visit included, each with their visit count, and that outlet's members are one step away, each with their end date, with no search entered

#### Scenario: One number keeps topping the gold list
- **WHEN** the owner orders an outlet's members by recent visits
- **THEN** the members with the most visits there in the last thirty days are first

#### Scenario: The lists grow long
- **WHEN** a list holds more than twenty customers
- **THEN** it is delivered twenty at a time, and every customer appears exactly once across the pages

#### Scenario: A manager looks for another outlet's customer
- **WHEN** a Franchise Admin searches for, lists, or opens by id a customer only an outlet they do not manage has served
- **THEN** that customer is not returned, exactly as though they did not exist

#### Scenario: A manager renames a shared customer
- **WHEN** a Franchise Admin renames a customer who has been served at any outlet they do not manage
- **THEN** the request is refused and nothing is written

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
