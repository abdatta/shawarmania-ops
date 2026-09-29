## ADDED Requirements

### Requirement: An outlet chooses its points rules, and starts with none

Each outlet SHALL hold its own points rules: whether points are on, how many
points a given amount earns, and the most of a bill points may pay, as a
percentage. Where the outlet has gold members, it SHALL also hold the most of a
gold member's bill points may pay, never less than everybody's, and how much
faster a gold member earns, as a multiplier of at least one. Every outlet SHALL start with points off, and an outlet with points
off SHALL bill exactly as it did before points existed.

Every amount in the rules SHALL be a whole number of rupees stored as integer
paise. One point SHALL be worth one rupee, and SHALL NOT be configurable.

The owner SHALL be able to change any outlet's rules, and a Franchise Admin those
of the outlets they manage. Every other principal SHALL be refused by the
database, however the request is made, and a manager's write SHALL reach these
rules and no other column of the outlet row.

#### Scenario: A new outlet
- **WHEN** an outlet is created
- **THEN** points are off, and no bill there earns or uses any

#### Scenario: A manager sets their own outlet's rate
- **WHEN** a Franchise Admin changes the earn rate of an outlet they manage
- **THEN** it is stored and applies to bills that reach the server afterwards

#### Scenario: A manager's hand-crafted write elsewhere
- **WHEN** a Franchise Admin sends a valid-session request changing another outlet's points rules
- **THEN** the database refuses it and nothing changes

#### Scenario: Points are turned off
- **WHEN** an outlet with balances turns points off
- **THEN** nothing further is earned or used there, the balances remain readable to the owner and the outlet's managers, and they resume if points come back on

### Requirement: Points belong to the outlet where they were earned

A customer's points SHALL be held per outlet. Points earned at one outlet SHALL
be used only at that outlet, and SHALL NOT be readable, usable or transferable at
any other.

A balance SHALL be the sum of that customer's stored entries at that outlet, and
SHALL NOT be stored on the business-wide customer record.

#### Scenario: A customer at a second outlet
- **WHEN** a customer holding points at one outlet is identified at another
- **THEN** the second outlet's counter reports its own balance for them, and uses nothing from the first

#### Scenario: A neighbouring outlet asks
- **WHEN** a counter device, Biller or Franchise Admin of one outlet requests another outlet's entries by hand-crafted request
- **THEN** nothing is returned

### Requirement: Every change to a balance is a stored entry naming its bill

Every earn, every use, and every reversal of either SHALL be stored as its own
entry carrying the outlet, the customer, the bill it belongs to, its kind, its
signed number of points, and the balance after it. Entries SHALL be append-only:
no entry SHALL be changed or deleted by any role.

A bill SHALL earn at most once, use at most once, and be reversed at most once,
however often its command is delivered.

An entry that earns SHALL also store the amount it was earned on and the rule
that produced it, so what a bill earned is explained by the bill and never by
the outlet's current settings.

#### Scenario: The outbox delivers a bill twice
- **WHEN** a bill's command is accepted and then replayed
- **THEN** exactly one earn entry exists for it

#### Scenario: Somebody asks who gave these points
- **WHEN** an entry is inspected
- **THEN** its bill names the outlet, the till, the shift and the operator that rang it

#### Scenario: An entry is altered
- **WHEN** any principal attempts to update or delete an entry
- **THEN** the database refuses it

### Requirement: A paid bill earns in proportion to what it cost before points

When a settled bill reaches the server naming a customer, at an outlet whose
points are on at that moment, the server SHALL record the points it earns. No
client SHALL name them.

A bill SHALL earn on its subtotal less every discount except points, and not on
its rounding. It SHALL earn `floor(amount × points × multiplier ÷ block)` under
the outlet's rate, rounded down per bill, computed in integers, where the
multiplier is one unless the bill's own membership snapshot is gold at an outlet
with gold on, when it is that outlet's gold multiplier.

A bill that earns nothing SHALL record no earn entry.

#### Scenario: A bill between blocks
- **WHEN** a ₹399 bill is paid at an outlet earning 5 points per ₹200
- **THEN** it earns 9 points

#### Scenario: Points were used on the bill
- **WHEN** a ₹200 bill is paid as ₹180 and 20 points
- **THEN** it earns 5 points, on the ₹200, and not 4

#### Scenario: Another discount was given
- **WHEN** a ₹300 bill carries a ₹100 discount by hand
- **THEN** it earns on ₹200

#### Scenario: An anonymous bill
- **WHEN** a bill is paid with the customer skipped
- **THEN** nothing is earned

#### Scenario: A bill rung offline
- **WHEN** a bill rung offline for an identified customer reaches the server later
- **THEN** it earns once, under the rules in force when it arrived, and stores the rule it used

### Requirement: Points are used as a discount, up to the outlet's cap, only from a balance just read

A biller SHALL be able to use some or all of an identified customer's balance
here on the order in front of them, as a discount of its own source recorded
beside every other discount.

The most offered SHALL be the least of: the balance just read from the server;
the outlet's cap, a percentage of the order after every other discount, with the
gold cap for a customer the tablet knows to be gold here; and the order after
every other discount less one rupee. Points SHALL combine with menu and biller
discounts.

Using points SHALL be available only when the balance was read from the server
after this order's customer was identified. A remembered balance SHALL be shown as
remembered and SHALL NOT be usable.

The points on an order SHALL be the lesser of what the biller asked for and the
most allowed, so that they fall when the order shrinks and never exceed what was
asked when it grows again. When the customer is changed or skipped, the points
SHALL be removed.

The balance reported to the counter SHALL exclude points already placed on that
customer's open orders at this outlet.

#### Scenario: A regular uses points
- **WHEN** a ₹300 order for a customer holding 80 points is rung at an outlet capping use at 10%
- **THEN** at most 30 points are offered

#### Scenario: A gold member uses points
- **WHEN** the same order is rung for a customer the tablet knows to be gold, at a gold cap of 50%
- **THEN** all 80 are offered

#### Scenario: The tablet is offline
- **WHEN** a customer is identified from what the tablet remembers, with no server reach
- **THEN** their balance is shown as remembered and points cannot be used

#### Scenario: Items are removed
- **WHEN** an order carrying the most points allowed loses an item
- **THEN** the points fall to the new most allowed, and rise no further than the biller asked for if the item is added back

#### Scenario: Two open orders
- **WHEN** a customer has points placed on one open order and is identified on another
- **THEN** the second is offered only what remains

### Requirement: The ledger, not the boundary, answers a use beyond balance or cap

The command boundary SHALL refuse a points discount that is malformed: not an
amount in whole rupees, more than one on an order, on an order with no customer,
or more than the order after other discounts less one rupee.

It SHALL NOT refuse a paid sale because its points exceed the customer's balance
or the outlet's cap. The use SHALL be recorded, and a balance it takes below
nought SHALL remain below nought until later earning restores it. Nothing SHALL
be offered for use while a balance is not positive.

#### Scenario: Two tills spend the same points
- **WHEN** two tills each use a customer's whole balance before either reaches the server
- **THEN** both sales settle, and the balance reads negative by the second use

#### Scenario: A malformed use
- **WHEN** a payload carries a points discount of ₹10.50
- **THEN** the command is refused and nothing is written

### Requirement: A void takes back what a bill earned and returns what it used

When a bill becomes void, by any path, the server SHALL in the same transaction
record the reversal of what it earned and the return of what it used. A balance
MAY go below nought as a result.

#### Scenario: Earned points were already spent
- **WHEN** a bill that earned 10 points is voided after the customer used them
- **THEN** the balance falls by 10, below nought if need be, and nothing further can be used until it recovers

#### Scenario: A bill that used points is voided
- **WHEN** a bill that used 20 points is voided
- **THEN** the 20 points return to the balance

### Requirement: Points begin when an outlet turns them on

No bill that reached the server before an outlet turned points on SHALL earn at
that outlet.

#### Scenario: Switching on
- **WHEN** an outlet turns points on
- **THEN** every customer's balance there is what bills from that moment earn and use
