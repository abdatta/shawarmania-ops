## REMOVED Requirements

### Requirement: The manual ledger is reachable only by an owner, and the database is what refuses everyone else

**Reason**: The owner-only rule described production rather than a decision. Both
Super Admins held no Franchise Admin assignment at either outlet, so the owners
were the managers, and the requirement recorded that accident as a boundary. The
requirement cannot be amended in place because its own title asserts the rule
this change removes.

**Migration**: Replaced by "The day record is reachable by owners, and by
managers at the outlets they are assigned to" below, which keeps every clause
still in force, rewrites all four scenarios rather than dropping them so the
archive keeps a readable record of what the boundary was, and states what the
refusal of outlet staff is actually protecting. No stored row changes.

### Requirement: The manual ledger grants no authority that survives it, and its rows outlive its surface

**Reason**: The clause stating that the owner's ability to write cash figures
here is not precedent for the live cash record still holds and is retained, but
the requirement as written asserts a single-writer, owner-only capability that
this change replaces.

**Migration**: Replaced by "The manual ledger is a record only, and its rows
outlive its surface" below, which keeps every clause that is still true and drops
the ones describing an authority model no longer in force. No stored row changes.
`daily-cash-live` (#12) still owns the retirement, and its inherited obligation
grows in the same change: carrying these rows across now means carrying
attribution and void state as well as amounts, dates and categories. It does not
mean carrying settlement or payment states, which this change deliberately does
not create.

## ADDED Requirements

### Requirement: The day record is reachable by owners, and by managers at the outlets they are assigned to

The manual ledger's day record and its full surface SHALL be available to an
account holding a live Super Admin assignment at any outlet, and to an account
holding a live Franchise Admin assignment **at the outlets that assignment
names**. A Franchise Admin SHALL be refused every select, insert, update and
delete on `manual_ledger_days` at every outlet they do not hold a live
assignment at, by Row-Level Security rather than by the interface.

A Biller or an Employee SHALL be refused every select, insert, update and delete
on `manual_ledger_days` at every outlet, including outlets where they hold a
live assignment. The refusal SHALL be the absence of a policy branch, not a
hidden screen.

That refusal protects two distinct things and the difference SHALL be stated
rather than left implied.

On the **write** side it protects the drawer. No outlet staff account SHALL be
able to set a day's counted cash, opening cash or cash removed, because a staff
account that could set any of them could make any drawer reconcile, and the
nightly count is the only control the business has over cash.

On the **read** side it protects history and aggregates: any past business date,
any month's total, any other outlet, and every figure net of commission. None of
these is observable from behind a counter, and a running total across weeks is
not the same information as one evening's cash.

The system SHALL NOT claim that the takings of a shift a staff member worked, at
the outlet they worked it in, are confidential. That person stands where the
sales happen and could tally them. No requirement, test or later feature SHALL
rest on the premise that such a figure is secret. The policy nevertheless
refuses every day row without checking who was rostered, because the concession
is a limit on what the system may claim and not an instruction to open a hole.

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
- **THEN** the database refuses it and returns no rows

#### Scenario: Staff cannot move the drawer figures

- **WHEN** a Biller or an Employee issues a hand-crafted update setting a day's counted cash, opening cash or cash removed at their own outlet
- **THEN** the database refuses each of them and every figure on that day is unchanged

#### Scenario: A past day and a month total stay out of reach

- **WHEN** a Biller or an Employee issues a hand-crafted select for a business date other than the current one, or for a range spanning a month, at their own outlet
- **THEN** the database returns no rows, so no past day's revenue and no monthly aggregate is reachable

#### Scenario: The day surface is absent rather than forbidden

- **WHEN** a Biller or an Employee navigates directly to the manual-ledger path
- **THEN** no manual-ledger surface renders and no manual-ledger request is issued

#### Scenario: Losing an assignment ends access

- **WHEN** an account's assignment is ended or the account is deactivated
- **THEN** its next manual-ledger request is refused without waiting for token expiry, at every outlet that assignment reached

### Requirement: Everyone at an outlet reads its expenses, and each staff member corrects only their own, on the day they recorded them

An account holding a live Biller or Employee assignment at an outlet SHALL be
able to read every expense recorded against that outlet, whoever recorded it,
and SHALL be refused every expense at every outlet they hold no live assignment
at, by the database rather than by the interface.

That read SHALL NOT be limited by business date. An expense row is not a revenue
figure, so there is nothing to protect by withholding an old one, and any date
window a surface applies SHALL be a presentation default rather than a rule the
database enforces.

Such an account SHALL be able to record an expense at that outlet against the
**current business date only**, resolved through that outlet's own business-day
cutover so that an expense entered after midnight still belongs to the trading
day that is running. A staff-recorded expense against any other date SHALL be
refused by the database.

Such an account SHALL be able to correct or void **only expenses it recorded
itself**, and only while that expense's business date is still the current
business date. An expense that outlives its own business date SHALL be
immutable to the account that recorded it.

**This ownership rule holds only while a Biller signs in as themselves.** When
the counter tablet becomes an enrolled device with a shift PIN, that PIN selects
attribution and is not a security boundary, so `recorded_by` will name whoever
the shift claims to be and Row-Level Security will have no session identity to
check it against. "Only expenses it recorded itself" SHALL at that point degrade
to "only expenses recorded during this shift", and the change that enrols the
device SHALL state which of the two it is enforcing rather than leaving this
requirement to quietly stop meaning what it says. This limitation is recorded
now, before it bites, rather than discovered when the rule is already wrong.

An account holding a live Franchise Admin assignment SHALL be able to record,
correct and void any expense at the outlets that assignment names, against any
business date the capability allows. An account holding a live Super Admin
assignment SHALL be able to do so at every outlet.

Every expense SHALL name the account that recorded it wherever it is listed, so
that which rows a reader may still correct is legible rather than remembered.

An expense that both comes from the drawer and was recorded by an account
holding no live assignment at that outlet SHALL be marked as recorded from away,
beyond naming its recorder. Unlike the live expense record, which refuses a
remote cash expense outright so that the owner's remote entries cannot move an
outlet's drawer, this notebook permits one: the owner may write any figure at
any outlet, and a drawer expense they enter from elsewhere changes what the
people counting that drawer should expect to find. The marking is what tells
them. A non-cash expense recorded from away SHALL carry no such marking, because
it moves no drawer and the recorder's name is the whole story.

A cash expense that was never made SHALL NOT be detectable by the drawer count,
because an invented expense lowers expected cash and the count still matches.
The count catches a missing entry, never an invented one. The controls on a
staff-recorded expense SHALL therefore be understood as attribution and the void
trace, and no requirement SHALL imply the nightly count is a check on it.

#### Scenario: A staff member records an expense at their own outlet

- **WHEN** a Biller or Employee records an expense against the current business date at an outlet they hold a live assignment at
- **THEN** it is stored, attributed to them, and appears immediately on that outlet's expense list for every reader of that outlet

#### Scenario: Everyone at the outlet reads every expense

- **WHEN** a Biller or Employee reads their outlet's expenses
- **THEN** the list includes expenses recorded by other staff, by the manager and by the owner, each naming who recorded it

#### Scenario: An older expense is readable, not refused

- **WHEN** a Biller or Employee issues a hand-crafted select for an expense at their own outlet dated before any window the surface shows
- **THEN** the database returns it, because the window is a surface default and not a boundary

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

#### Scenario: The owner's drawer expense at an outlet they are not at is marked

- **WHEN** a Super Admin holding no live assignment at an outlet records an expense there as coming from the drawer
- **THEN** the row is marked as recorded from away wherever it is listed, so that whoever counts that drawer can see why the expected cash moved

#### Scenario: A non-cash expense from away is not marked

- **WHEN** the same account records a non-cash expense at that outlet
- **THEN** the row names its recorder and carries no from-away marking, because it moves no drawer

#### Scenario: A manager corrects any row at their outlet

- **WHEN** a Franchise Admin corrects or voids an expense recorded by a staff member at an outlet they are assigned to
- **THEN** the write succeeds, and the same act at an outlet they hold no assignment at is refused by the database

### Requirement: A removed expense leaves a trace rather than disappearing

An expense SHALL NOT be deletable. Removing one SHALL void it: the row SHALL
remain stored and readable, carrying the moment it was voided and the account
that voided it.

A reason SHALL be optional. Voiding is the fastest correction on a surface used
with thumbs, and the failure it answers is a row disappearing, which the moment
and the account already answer. Where a reason is given it SHALL be stored and
shown; where one is absent the trace SHALL still read as complete rather than as
missing a field. A reason SHALL NOT be stored blank or whitespace-only: it is
either present with content or absent.

A voided expense SHALL be shown to every reader of that outlet, including
outlet staff, marked so that it reads as withdrawn rather than as an ordinary
entry. It SHALL NOT count toward that day's expected cash, that day's expense
list total, or any figure in that month, including that month's breakdown by
category.

A voided expense SHALL NOT be editable, un-voidable or re-voidable. A correction
after voiding is a new expense.

The day record SHALL remain deletable by an account that may write it, because a
day typed against the wrong date is a mistake with no story worth keeping and
only owners and managers can reach it.

#### Scenario: Voiding keeps the row

- **WHEN** an expense is voided
- **THEN** the row remains stored with the moment and the account, and appears in the day's list marked as withdrawn

#### Scenario: A voided expense stops counting

- **WHEN** a day and a month containing a voided expense are read
- **THEN** that expense is absent from the day's expected cash, from the day's total and from every month figure including the category breakdown, while every other expense is unchanged

#### Scenario: Staff see the withdrawal

- **WHEN** a Biller or Employee reads their outlet's expenses after one has been voided
- **THEN** the voided expense is visible and marked as withdrawn, rather than absent

#### Scenario: Voiding without a reason succeeds

- **WHEN** a void is submitted with no reason
- **THEN** the write succeeds, the row is marked as withdrawn, and its trace names the moment and the account

#### Scenario: A blank reason is not stored as a reason

- **WHEN** a void is submitted with a blank or whitespace-only reason, including by a hand-crafted request
- **THEN** the row is not stored carrying an empty reason, so a reader is never shown a reason field with nothing in it

#### Scenario: Deletion is refused by the database

- **WHEN** a delete is issued against an expense by any role, including by a hand-crafted request
- **THEN** the database refuses it

#### Scenario: A voided expense is final

- **WHEN** an edit, an un-void or a second void is attempted against an already-voided expense
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

The surface SHALL open on the expenses recorded against the **two most recent
business days** for that outlet. That window is where the surface opens rather
than a boundary, and SHALL NOT be enforced by the database, for the reason given
in the expense-reading requirement above.

The expense list and its entry form SHALL be the same component the day surface
renders, mounted without the day's figures around it, rather than the day
surface shown with sections removed by role. A single surface rendering
different amounts of financial truth depending on who is reading it puts a role
check in front of every figure it draws, and each such check is a place a figure
can later leak.

Each listed expense SHALL show its category, its amount, whether it came from
the drawer, its note and the account that recorded it. Everything else the row
holds, including the void reason and the account that voided it, SHALL be
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
- **THEN** its recorder, timestamps, and void reason and actor where present are shown without leaving the list

#### Scenario: The same list serves both readers

- **WHEN** an expense is recorded from the staff surface and the day surface is then opened for that business date by a manager
- **THEN** the row appears in the day surface's expense list unchanged, because both surfaces render the same list from the same rows

#### Scenario: A staff member assigned at two outlets chooses one

- **WHEN** an account holds live staff assignments at more than one outlet
- **THEN** the surface offers a choice of outlet, and a hand-crafted request naming an outlet they hold no assignment at is still refused by the database

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
every row, the account that recorded it, the account that last corrected it, and
whether it was voided and by whom and why. Dropping the tables without that
carry-over SHALL NOT satisfy the removal.

#### Scenario: No live figure moves

- **WHEN** a manual-ledger day or expense row is written, corrected or voided
- **THEN** no attendance, bill, live expense, inventory, cash record or live report figure changes

#### Scenario: No live surface reads the notebook

- **WHEN** the live cash, expense or owner-console surfaces are rendered
- **THEN** none of them queries a manual-ledger table

#### Scenario: The owner's live cash boundary is unchanged

- **WHEN** a Super Admin attempts a cash expense, a withdrawal or a day close at an outlet they hold no assignment at, through the live path
- **THEN** the database refuses it exactly as before, unaffected by this capability existing

#### Scenario: Retirement carries the attribution, not only the amounts

- **WHEN** the change that removes this capability runs
- **THEN** every recorded day and expense row is carried into the live cash and expense records with its recording account, correcting account, and void state and reason intact, and the removal is incomplete until it is
