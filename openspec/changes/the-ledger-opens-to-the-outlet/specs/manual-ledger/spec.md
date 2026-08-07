## MODIFIED Requirements

### Requirement: The manual ledger is reachable only by an owner, and the database is what refuses everyone else

The manual ledger's day record and its full surface SHALL be available to an
account holding a live Super Admin assignment at any outlet, and to an account
holding a live Franchise Admin assignment **at the outlets that assignment
names**. A Franchise Admin SHALL be refused every select, insert, update and
delete on `manual_ledger_days` at every outlet they do not hold a live
assignment at, by Row-Level Security rather than by the interface.

A Biller or an Employee SHALL be refused every select, insert, update and delete
on `manual_ledger_days` at every outlet, including outlets where they hold a
live assignment. That row carries revenue by channel, commission rates, opening
cash and the counted drawer, and no outlet staff role has any business reading
any of them. The refusal SHALL be the absence of a policy branch, not a hidden
screen.

The expense record SHALL be reachable by outlet staff under the separate
requirement below, which is a narrower grant against a different table.

Deactivating an account, or ending the assignment that granted its reach, SHALL
end that access on the account's next request rather than at token expiry.

#### Scenario: An owner opens the ledger

- **WHEN** an account with a live Super Admin assignment signs in
- **THEN** the manual ledger appears in their navigation and opens for every outlet

#### Scenario: A manager opens the ledger at an outlet they are assigned to

- **WHEN** an account with a live Franchise Admin assignment signs in
- **THEN** the manual ledger appears in their navigation and opens for each outlet that assignment names, showing the day and the month in full

#### Scenario: A manager is refused another outlet's ledger by the database

- **WHEN** a Franchise Admin issues a hand-crafted select or insert against either manual-ledger table, naming an outlet where they hold no live assignment
- **THEN** the database refuses it and returns no rows, with no reliance on the interface having hidden anything

#### Scenario: Outlet staff are refused the day record at their own outlet

- **WHEN** a Biller or an Employee issues a hand-crafted select, insert, update or delete against `manual_ledger_days`, naming an outlet where they hold a live assignment
- **THEN** the database refuses it and returns no rows, so no revenue, commission rate, opening cash or drawer count is reachable by any outlet staff role anywhere

#### Scenario: The day surface is absent rather than forbidden

- **WHEN** a Biller or an Employee navigates directly to the manual-ledger path
- **THEN** no manual-ledger surface renders and no manual-ledger request is issued

#### Scenario: Losing an assignment ends access

- **WHEN** an account's assignment is ended or the account is deactivated
- **THEN** its next manual-ledger request is refused without waiting for token expiry, at every outlet that assignment reached

## ADDED Requirements

### Requirement: Everyone at an outlet reads its expenses, and each staff member corrects only their own, on the day they recorded them

An account holding a live Biller or Employee assignment at an outlet SHALL be
able to read every expense recorded against that outlet, whoever recorded it,
and SHALL be refused every expense at every outlet they hold no live assignment
at, by the database rather than by the interface.

Such an account SHALL be able to record an expense at that outlet against the
**current business date only**, resolved through that outlet's own business-day
cutover so that an expense entered after midnight still belongs to the trading
day that is running. A staff-recorded expense against any other date SHALL be
refused by the database.

Such an account SHALL be able to correct or void **only expenses it recorded
itself**, and only while that expense's business date is still the current
business date. An expense that outlives its own business date SHALL be
immutable to the account that recorded it.

An account holding a live Franchise Admin assignment SHALL be able to record,
correct and void any expense at the outlets that assignment names, against any
business date the capability allows. An account holding a live Super Admin
assignment SHALL be able to do so at every outlet.

Every expense SHALL name the account that recorded it wherever it is listed, so
that which rows a reader may still correct is legible rather than remembered.

#### Scenario: A staff member records an expense at their own outlet

- **WHEN** a Biller or Employee records an expense against the current business date at an outlet they hold a live assignment at
- **THEN** it is stored, attributed to them, and appears immediately on that outlet's expense list for every reader of that outlet

#### Scenario: Everyone at the outlet reads every expense

- **WHEN** a Biller or Employee reads their outlet's expenses
- **THEN** the list includes expenses recorded by other staff, by the manager and by the owner, each naming who recorded it

#### Scenario: Another outlet's expenses are refused

- **WHEN** a Biller or Employee issues a hand-crafted select against expenses at an outlet where they hold no live assignment
- **THEN** the database returns no rows

#### Scenario: A staff member cannot record against an earlier day

- **WHEN** a Biller or Employee submits an expense against any business date other than the current one, including by a hand-crafted request
- **THEN** the database refuses the write

#### Scenario: A staff member cannot touch another person's row

- **WHEN** a Biller or Employee attempts to correct or void an expense recorded by somebody else, including by a hand-crafted request
- **THEN** the database refuses it and the expense is unchanged

#### Scenario: Yesterday's own row is frozen

- **WHEN** a Biller or Employee attempts to correct or void an expense they recorded, whose business date is no longer the current business date
- **THEN** the database refuses it, and the same expense remains correctable by a Franchise Admin at that outlet and by the owner

#### Scenario: A manager corrects any row at their outlet

- **WHEN** a Franchise Admin corrects or voids an expense recorded by a staff member at an outlet they are assigned to
- **THEN** the write succeeds, and the same act at an outlet they hold no assignment at is refused by the database

### Requirement: A removed expense leaves a trace rather than disappearing

An expense SHALL NOT be deletable. Removing one SHALL void it: the row SHALL
remain stored and readable, carrying the moment it was voided, the account that
voided it, and a required reason.

A voided expense SHALL be shown to every reader of that outlet, including
outlet staff, marked so that it reads as withdrawn rather than as an ordinary
entry. It SHALL NOT count toward that day's expected cash, that day's expense
list total, or any figure in that month.

A voided expense SHALL NOT be editable, un-voidable or re-voidable. A correction
after voiding is a new expense.

The day record SHALL remain deletable by an account that may write it, because a
day typed against the wrong date is a mistake with no story worth keeping and
only owners and managers can reach it.

#### Scenario: Voiding keeps the row

- **WHEN** an expense is voided
- **THEN** the row remains stored with the moment, the account and the reason, and appears in the day's list marked as withdrawn

#### Scenario: A voided expense stops counting

- **WHEN** a day and a month containing a voided expense are read
- **THEN** that expense is absent from the day's expected cash, from the day's total and from every month figure, while every other expense is unchanged

#### Scenario: Staff see the withdrawal

- **WHEN** a Biller or Employee reads their outlet's expenses after one has been voided
- **THEN** the voided expense is visible and marked as withdrawn, rather than absent

#### Scenario: Voiding without a reason is refused

- **WHEN** a void is submitted with a missing, blank or whitespace-only reason, including by a hand-crafted request
- **THEN** the database refuses it and the expense is unchanged

#### Scenario: Deletion is refused by the database

- **WHEN** a delete is issued against an expense by any role, including by a hand-crafted request
- **THEN** the database refuses it

#### Scenario: A voided expense is final

- **WHEN** an edit, an un-void or a second void is attempted against an already-voided expense
- **THEN** the database refuses it

### Requirement: An expense states where its money came from, and one of the three states is that it has not been paid

Each expense SHALL carry exactly one of three states: paid **from the drawer**,
paid **from the bank**, or **pending**. The states SHALL be named by where the
money came from rather than by payment instrument, so that a purchase somebody
made from their own pocket is not recorded as drawer cash and does not read the
drawer short by money that never left it.

Only an expense paid from the drawer, and not voided, SHALL reduce a day's
expected cash. An expense paid from the bank and a pending expense SHALL NOT.

A pending expense SHALL be included in its month's expenses on its own business
date, when the cost was incurred rather than when it is paid, so that a
postponed supplier bill cannot flatter one month and distort the next. The
pending total SHALL be shown separately from the profit figure, because what the
business owes is its own reading.

The month's profit figure SHALL NOT be described as a cash-basis estimate, since
unpaid expenses are counted. It SHALL state its actual basis in words beside it,
as `profit-estimates` requires of any profit figure, and SHALL continue to be
described as an operating estimate because capital spending is still not
recorded.

#### Scenario: Only drawer money moves the drawer

- **WHEN** a day carries expenses paid from the drawer, paid from the bank and pending
- **THEN** expected cash falls by the drawer-paid expenses alone, and the other two leave it unchanged

#### Scenario: A pending expense counts in its month

- **WHEN** a month contains a pending expense
- **THEN** the month's expenses and profit include it on its own business date, and the pending total is shown separately

#### Scenario: The basis is stated truthfully

- **WHEN** the month's estimated profit is rendered
- **THEN** the words beside it state a basis that accounts for unpaid expenses being counted, do not call it a cash-basis estimate, and still identify it as an operating figure

### Requirement: Settling a pending expense moves the drawer on the day it is settled, never on the day it was incurred

Any account that may record an expense at an outlet SHALL be able to settle a
pending expense at that outlet, whoever recorded it and however old it is,
because a supplier presenting an invoice is paid by whoever is standing there.

Settling SHALL record the date it was settled and the account that settled it.
Settling from the drawer SHALL additionally record cash taken out of the drawer
**on the settlement date**, with a reason, so that the drawer falls on the day
the money actually left.

A settled expense SHALL NOT itself enter any day's expected cash, and settling
SHALL NOT change the expense's business date, its amount, or any figure on the
business date it was incurred on. A day already recorded and counted SHALL be
byte-for-byte unchanged by a settlement occurring after it.

An unsettled pending expense SHALL be listed to every reader of that outlet
**regardless of its age**, so that the item somebody is standing there to settle
is reachable however long it has been outstanding.

Where cash was already taken out of the drawer on the settlement date, the
settlement SHALL add to that amount and extend its reason rather than replacing
either, because the day record holds one cash-out figure and one reason. This is
a stated limitation of the day record's shape, not a rounding of the settlement.

A voided expense SHALL NOT be settleable.

#### Scenario: A supplier is paid from the drawer by whoever is there

- **WHEN** a Biller settles a pending expense from the drawer at their own outlet, recorded weeks earlier by somebody else
- **THEN** the settlement is stored with the date and the account, and cash taken out of the drawer on that settlement date increases by exactly that amount with a reason

#### Scenario: The day it was incurred does not move

- **WHEN** a pending expense is settled after the business date it was incurred on has been recorded and counted
- **THEN** that earlier day's opening cash, cash movements, expected cash, counted cash and difference are all unchanged

#### Scenario: Settling does not double-count

- **WHEN** a settled expense's month is read
- **THEN** the expense appears once, on its own business date, and the cash taken out on the settlement date is not counted as an expense

#### Scenario: An old pending item is still reachable

- **WHEN** a pending expense older than the expense list's usual window is unsettled
- **THEN** it is listed to every reader of that outlet, including outlet staff, until it is settled or voided

#### Scenario: Two settlements on one day share the cash-out line

- **WHEN** two pending expenses are settled from the drawer on the same business date
- **THEN** the day's cash taken out equals the sum of both, its reason names both, and neither settlement overwrites the other

#### Scenario: A voided expense cannot be settled

- **WHEN** a settlement is attempted against a voided expense, including by a hand-crafted request
- **THEN** the database refuses it

### Requirement: A corrected row says who corrected it, without rewriting who recorded it

Both manual-ledger records SHALL carry the account that last corrected the row,
in addition to the account that first recorded it. The recording account SHALL
remain immutable, as it is today; the correcting account SHALL be set from the
session on every update and SHALL NOT be settable by the caller.

Where the two differ, the reading SHALL show both, so that a day recorded by one
account and corrected by another does not read as though the first account
entered the figures now on screen.

Simultaneous corrections SHALL resolve as last write wins, which is the
behaviour a notebook should have. No conflict prompt SHALL be shown.

#### Scenario: A manager corrects the owner's day

- **WHEN** a Franchise Admin corrects a figure on a day recorded by the owner
- **THEN** the stored recording account is unchanged, the correcting account is theirs, and the reading names both

#### Scenario: The recorder cannot be forged

- **WHEN** an update naming a different recording account is submitted by a hand-crafted request
- **THEN** the database refuses it

#### Scenario: An uncorrected row names one account

- **WHEN** a row has never been corrected since it was recorded
- **THEN** the reading names the recording account alone and does not imply a second party

### Requirement: Outlet staff reach expenses through their own surface, which shows no revenue and no drawer

A Biller and an Employee SHALL each reach their outlet's expenses through a
navigation entry in their own shell, leading to a surface that shows expenses
and nothing else. It SHALL NOT show revenue by any channel, opening cash, cash
movements, the counted drawer, any commission rate, any difference, or any
monthly figure.

The surface SHALL show the expenses recorded against the **two most recent
business days** for that outlet, plus every unsettled pending expense whatever
its date.

Each listed expense SHALL show its category, its amount, whether it came from
the drawer, its note and the account that recorded it. Everything else the row
holds, including the void reason and actor and the settlement history, SHALL be
reachable by expanding the entry rather than shown by default, so that the list
stays readable on a phone held in one hand.

An account holding assignments at more than one outlet SHALL choose which outlet
this surface is about, and that choice SHALL confer no authority: the database
SHALL decide every read and write from the assignment.

#### Scenario: A biller opens their expenses

- **WHEN** a Biller signs in and opens their expenses entry
- **THEN** the two most recent business days of that outlet's expenses are listed, each naming its recorder, with no revenue, drawer or monthly figure anywhere on the surface

#### Scenario: Detail is reached deliberately

- **WHEN** a listed expense is expanded
- **THEN** its recorder, timestamps, void reason and actor where present, and settlement history are shown without leaving the list

#### Scenario: Pending items ignore the window

- **WHEN** the surface is opened and an unsettled pending expense exists that is older than two business days
- **THEN** it is listed alongside the recent days rather than being hidden by the window

#### Scenario: A staff member assigned at two outlets chooses one

- **WHEN** an account holds live staff assignments at more than one outlet
- **THEN** the surface offers a choice of outlet, and a hand-crafted request naming an outlet they hold no assignment at is still refused by the database

## REMOVED Requirements

### Requirement: The manual ledger grants no authority that survives it, and its rows outlive its surface

**Reason**: The clause stating that the owner's ability to write cash figures
here is not precedent for the live cash record still holds and is retained,
but the requirement as written asserts a single-writer, owner-only capability
that this change replaces. It is superseded by the requirements above together
with the replacement below, which keeps every clause that is still true and drops
the ones that describe an authority model no longer in force.

**Migration**: Replaced by "The manual ledger is a record only, and its rows
outlive its surface" below. No stored row changes. `daily-cash-live` (#12) still
owns the retirement, and its inherited obligation grows in the same change:
carrying these rows across now means carrying attribution, void state,
settlement state and the three payment states, not amounts and dates alone.

## ADDED Requirements

### Requirement: The manual ledger is a record only, and its rows outlive its surface

The manual ledger SHALL be a record only. It SHALL NOT read, write or influence
any live attendance, billing, expense, inventory, cash or reporting row, and no
live surface SHALL read from its tables.

The reach granted here SHALL NOT be taken as precedent for the live cash record,
whose boundary remains as documented: a Super Admin may not record a cash
expense, a withdrawal or a day close at an outlet they hold no assignment at.
That an outlet staff role may record a drawer expense in this notebook SHALL NOT
be taken as precedent for the live expense record either, whose grants are
`outlet-expenses`' own to decide.

The capability SHALL be removed only by a change that first carries its rows
into the live cash and expense records, so that a period recorded here remains
readable from the real reports afterwards. That carry-over SHALL preserve, for
every row, the account that recorded it, the account that last corrected it,
whether it was voided and by whom and why, whether it was settled and when, and
which of the three payment states it held. Dropping the tables without that
carry-over SHALL NOT satisfy the removal.

#### Scenario: No live figure moves

- **WHEN** a manual-ledger day or expense row is written, corrected, voided or settled
- **THEN** no attendance, bill, live expense, inventory, cash record or live report figure changes

#### Scenario: No live surface reads the notebook

- **WHEN** the live cash, expense or owner-console surfaces are rendered
- **THEN** none of them queries a manual-ledger table

#### Scenario: The owner's live cash boundary is unchanged

- **WHEN** a Super Admin attempts a cash expense, a withdrawal or a day close at an outlet they hold no assignment at, through the live path
- **THEN** the database refuses it exactly as before, unaffected by this capability existing

#### Scenario: Retirement carries the attribution, not only the amounts

- **WHEN** the change that removes this capability runs
- **THEN** every recorded day and expense row is carried into the live cash and expense records with its recording account, correcting account, void state and reason, settlement state, and payment state intact, and the removal is incomplete until it is
