# Manual Ledger

## Purpose

A **temporary** record of what each outlet took, spent and held in the drawer, kept by hand while billing, expenses and daily cash are not yet live. It answers two questions and no others: did the drawer balance on a given day, and did a month's trading cover its running costs. Revenue is split across cash, UPI, Zomato and Swiggy; aggregator commission is stored per day so a rate that changes mid-month is right on both sides of the change; every figure is integer paise and every derived figure is computed in one place.

This capability carries its own retirement contract. It grants no authority that outlives it, and it may be removed only by a change that first carries its rows into the live cash and expense records.
## Requirements
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

**On a counter tablet this rule means "recorded while you held this counter",
and that is now settled.** This paragraph used to anticipate a shift PIN, note
that a PIN selects attribution and is not a security boundary, and leave open
which of two readings would survive. `counter-devices-and-offline` answered it:
a tablet has no `auth.uid()` belonging to a person, so an expense recorded from
one SHALL be attributed to **the operator named on the live shift**, read from
the shift row and never from the request body. The reading that survived is the
stronger one, because a shift names somebody who confirmed it from their own
phone rather than somebody whose four digits were typed at the counter.

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

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

The ledger SHALL record at most one day row per outlet per business date,
enforced by a uniqueness constraint in the database. Each row SHALL hold, in
integer paise: revenue received as cash and as UPI; revenue for each aggregator
channel the ledger does **not** source; cash brought into the drawer; cash taken
out of the drawer; opening cash; and the drawer count at close. It SHALL also
hold a reason for any non-zero cash movement and an optional free-text note.

A sourced channel's revenue and commission SHALL NOT be columns on this row. They
belong to `aggregator-figures`, because this row cannot exist without a drawer
count while a sourced figure must be readable for a day nobody counted.

Money SHALL be integer paise throughout, so that no figure on this surface is
ever a float. The business date SHALL be an explicit `date` column and SHALL NOT
be derived from a timestamp when read.

A negative revenue figure SHALL be permitted, because a cash refund is recorded
by reducing that day's cash revenue. A negative opening cash, drawer count,
cash-in or cash-out figure SHALL be refused, as SHALL a future business date.

#### Scenario: A day is recorded for one outlet

- **WHEN** the owner records cash and UPI revenue, any unsourced aggregator revenue, a drawer count and any cash movements for an outlet and business date
- **THEN** one day row is stored in integer paise against that explicit business date

#### Scenario: A second row for the same day is refused

- **WHEN** a second day row is submitted for an outlet and business date that already has one, including by a hand-crafted request
- **THEN** the database refuses it and the existing row is unchanged

#### Scenario: Both outlets keep separate days

- **WHEN** the same business date is recorded for both outlets
- **THEN** two independent rows exist and neither outlet's figures contribute to the other's day or month

#### Scenario: A cash movement states its reason

- **WHEN** cash in or cash out is non-zero
- **THEN** a reason is required and stored, and a blank or whitespace-only reason is refused by the database

#### Scenario: A refund reduces cash revenue

- **WHEN** cash is returned to a customer
- **THEN** it is recorded by lowering that day's cash revenue, and the negative figure is accepted

#### Scenario: An impossible figure is refused

- **WHEN** a negative drawer count, negative opening cash, negative cash movement or future business date is submitted by a hand-crafted request
- **THEN** the database refuses the write

#### Scenario: A sourced figure cannot be attached to the day row

- **WHEN** a day row is submitted carrying a sourced channel's revenue or commission, including by a hand-crafted request
- **THEN** the database refuses the write rather than accepting the row and discarding those figures

### Requirement: An expense is its own row, categorised and marked cash or non-cash

Each expense SHALL be stored as one row carrying an outlet, an explicit
business date, a **required category**, whether it was paid in cash, an amount in
integer paise, and an optional note. Any number of expense rows SHALL be
permitted for one outlet and business date.

The category SHALL be free text drawn from the business-wide growing list
defined by `expense-categories`, and SHALL be mandatory, because a category and
an amount alone do not identify a purchase weeks later and an expense nobody can
identify is not a record. It SHALL be refused when blank or whitespace-only, by
the database and not only by the form, under the same rule every other required
field in the app already follows.

The note SHALL be free text and SHALL be optional, carrying detail the category
does not, such as a quantity. It SHALL be refused when present but blank or
whitespace-only, exactly as the day's note is. It SHALL NOT be mandatory,
because the requirement that an expense identify itself is now carried by the
category, and requiring both would mean typing the same words twice.

A category SHALL NOT be an aggregator commission, cash banked or an owner
drawing, because each of those is accounted for elsewhere and a category for one
would double-count it. Because the category is free text, this SHALL be enforced
as a warning rather than as a refusal, as `expense-categories` states.

A capital purchase (equipment, fittings or anything whose useful life exceeds
the month) SHALL NOT be recorded as an expense row, and no capital marker SHALL
exist on the expense table. Such a purchase is out of this capability's scope by
owner decision, so the monthly estimate it produces is an operating figure.

Where a capital purchase is nevertheless paid from the drawer, it SHALL be
recorded as cash taken out with its reason, so that expected cash still
reconciles against the count. Recording it that way SHALL keep it out of the
month's expenses, because cash movements are not expenses.

Only an expense marked as cash SHALL affect the drawer. A blank category, a
present-but-blank note, a zero-or-negative amount and a future business date
SHALL be refused by the database.

#### Scenario: A cash expense reaches the drawer

- **WHEN** an expense is recorded as paid in cash for an outlet and business date
- **THEN** it is subtracted from that outlet's expected cash for that date and included in that month's expenses

#### Scenario: A non-cash expense does not reach the drawer

- **WHEN** an expense is recorded as not paid in cash
- **THEN** that day's expected cash is unaffected while the month's expenses still include it

#### Scenario: A capital purchase paid from the drawer keeps the drawer honest

- **WHEN** equipment is bought with cash from the drawer
- **THEN** it is recorded as cash taken out with its reason rather than as an expense, expected cash falls by that amount so the count still reconciles, and the month's expenses do not include it

#### Scenario: Commission and cash movements are warned against rather than absent

- **WHEN** a category naming aggregator commission, cash banked or an owner drawing is typed
- **THEN** the surface warns where that figure belongs instead and still accepts the entry, because free text cannot be closed against a spelling

#### Scenario: Every expense says what it was for

- **WHEN** an expense is recorded
- **THEN** a category naming what the money was spent on is stored with it, and the day's expense list and the month's expenses by category both show it

#### Scenario: An expense without a category is refused

- **WHEN** an expense with a missing, blank or whitespace-only category is submitted, including by a hand-crafted request
- **THEN** the database refuses the write and no expense row is created

#### Scenario: An expense without a note is accepted

- **WHEN** an expense is recorded with a category and an amount and no note
- **THEN** it is stored, and the day's expense list and the month's breakdown both show it under its category

#### Scenario: A blank note is refused while an absent one is not

- **WHEN** an expense carrying a note that is present but blank or whitespace-only is submitted by a hand-crafted request
- **THEN** the database refuses the write, while the same expense with no note at all is accepted

#### Scenario: An invalid expense is refused

- **WHEN** an expense with a blank category, a zero or negative amount, or a future business date is submitted by a hand-crafted request
- **THEN** the database refuses the write

### Requirement: Commission and opening cash are snapshotted per day, so editing an old day never rewrites a later one

Each day row SHALL store its own commission per channel and its own opening cash
as stored values rather than deriving them when read.

When the entry form opens for a new day it SHALL offer the counted cash from that
outlet's immediately preceding day row as the opening cash, editable. It SHALL
NOT offer, inherit or default a commission figure for any channel [owner,
2026-08-17]: commission is an amount, so the previous day's is a function of the
previous day's revenue and would be wrong by construction while looking
deliberate. A blank field is the honest offer.

A commission SHALL be required for any channel whose revenue for that day is
non-zero, and SHALL default to nought for a channel that earned nothing, because
a channel with no orders was charged nothing and that is a fact rather than an
unanswered question.

Editing an existing day's commission, counted cash or any other figure SHALL
change only that day. It SHALL NOT alter any other day's stored opening cash,
commission, expected cash or difference. A synced figure arriving for one
business date SHALL likewise change only that date.

Where a day's stored opening cash disagrees with the immediately preceding day
row's counted cash, the surface SHALL show that disagreement as a read-only
signal beside the day. It SHALL NOT repair the figure, because a stored figure
the owner entered is evidence and a recomputed one is not.

#### Scenario: A new day inherits the previous day's close

- **WHEN** the owner opens the form for a business date following an existing day row at that outlet
- **THEN** opening cash is offered as that preceding row's counted cash, editable, and both commission fields are empty

#### Scenario: The first tracked day is seeded by hand

- **WHEN** the owner records the first day row for an outlet, with no earlier row to inherit from
- **THEN** opening cash is a required entry with no inherited default, as is the commission on any channel that earned something

#### Scenario: Correcting an old day leaves later days alone

- **WHEN** the owner edits the counted cash or commission on a day that has later day rows at the same outlet
- **THEN** only that day's stored figures, expected cash and difference change, and every later day's stored opening cash, commission, expected cash and difference are byte-for-byte unchanged

#### Scenario: A broken chain is visible

- **WHEN** a day's stored opening cash differs from the preceding day row's counted cash
- **THEN** the surface shows the disagreement beside that day and changes no stored figure

#### Scenario: A retrospective commission edit moves no cash figure

- **WHEN** the owner changes a past day's Zomato or Swiggy commission
- **THEN** that day's net aggregator revenue and the month's profit change, while its expected cash, counted cash and difference are unchanged

#### Scenario: Nothing is asked for on a synced channel

- **WHEN** the owner opens the form for a business date whose Zomato figures are synced
- **THEN** neither a Zomato revenue nor a Zomato commission field is offered, and the day's net is its read revenue less its read commission

#### Scenario: A settled figure moves only its own day

- **WHEN** a payout settles and the sync rewrites one business date's figures
- **THEN** only that date's stored figures and the month's totals change, and every other day's stored figures are byte-for-byte unchanged

### Requirement: A day reads as expected cash against the count, with the difference and its note together

For a chosen outlet and business date the surface SHALL show expected cash
computed as opening cash, plus cash revenue, plus cash brought in, minus cash
expenses recorded for that outlet and date, minus cash taken out. It SHALL show
the counted cash, the difference computed as counted minus expected, and the
day's note beside that difference.

The difference SHALL be shown with its direction stated, so that a drawer
holding less than expected and one holding more are not read as the same
condition. UPI, Zomato and Swiggy revenue SHALL NOT enter this calculation, and
a non-cash expense SHALL NOT enter it.

Each cash quantity SHALL be named the same way wherever it appears — the entry
field, the reading and the month's prose — and two opposite movements SHALL NOT
be named in words that differ only in their last word.

#### Scenario: A balanced day

- **WHEN** counted cash equals expected cash
- **THEN** the difference reads as nil and the day is shown as balanced

#### Scenario: A short drawer

- **WHEN** counted cash is below expected cash
- **THEN** the difference is shown as a shortfall with its direction stated, and the day's note is shown beside it

#### Scenario: A surplus drawer

- **WHEN** counted cash is above expected cash
- **THEN** the difference is shown as a surplus with its direction stated, and is not presented in the same words as a shortfall

#### Scenario: Non-cash channels stay out of the drawer

- **WHEN** a day carries UPI, Zomato or Swiggy revenue and non-cash expenses
- **THEN** none of them changes expected cash, and only cash revenue, cash movements and cash expenses do

#### Scenario: Cash movements are not expenses

- **WHEN** a day records cash banked or an owner drawing as cash taken out
- **THEN** expected cash falls by that amount and the month's expenses do not include it

### Requirement: A recorded day is presented as a reading, and its entry fields are reached deliberately

Where a day row already exists, the surface SHALL present its figures as a
read-only reading and SHALL NOT leave entry fields on screen. It SHALL offer one
control that returns the entry fields, populated with the stored figures exactly
as stored, and one that leaves them again without writing anything.

The reading SHALL account for every figure the row holds: revenue by channel,
each aggregator's stated revenue together with the commission rate stored against
that day and the amount actually received, the drawer's opening cash, movements,
count and difference, and the reason recorded for any non-zero cash movement.
Each cash movement's reason SHALL be shown beside the amount it explains, because
the entry field that captured it is not on screen.

While a day is being entered or corrected, the difference SHALL continue to be
computed from the figures as they are typed rather than only after a save.

#### Scenario: A recorded day opens as a reading

- **WHEN** the owner opens an outlet and business date that already has a day row
- **THEN** its figures are shown as a reading with no entry fields on screen, and the drawer's difference is shown from the stored figures

#### Scenario: Editing returns the stored figures unchanged

- **WHEN** the owner chooses to edit a recorded day
- **THEN** every entry field is populated with the stored figure exactly as stored, and the difference resumes being computed as figures are typed

#### Scenario: Leaving an edit writes nothing

- **WHEN** the owner changes figures while editing a recorded day and then leaves the edit without saving
- **THEN** the reading returns showing the stored figures, and the stored row is unchanged

#### Scenario: Saving returns to the reading

- **WHEN** a day is saved, whether newly recorded or corrected
- **THEN** the entry fields give way to the reading of what was just stored, and the save is acknowledged

#### Scenario: A cash movement's reason is readable without the form

- **WHEN** a recorded day carries cash brought in or taken out
- **THEN** the reason stored for that movement is shown beside its amount in the reading

### Requirement: The entry form groups each aggregator with its own rate and result, and its explanations are available rather than displayed

Each aggregator SHALL be presented as one group showing what was measured: the
stated revenue, the commission charged on it, and what those two produce. That
group SHALL contain **no revenue field and no commission field**, for every
aggregator the ledger sources, whether or not a figure has arrived for that day
yet. Where commission is not yet known, the group SHALL say so and SHALL NOT
present the stated figure as though all of it had arrived.

The withdrawal is total rather than conditional on the day being sourced. A form
offering fields for one channel and a reading for another invites the reader to
believe the difference is about the day rather than about the channel, and the
figures no longer live on the row the form saves, so there is nothing for a field
to write to.

Where the ledger does not source a channel, that channel SHALL keep its entry
fields, and the form SHALL state why the two channels differ rather than leaving
the asymmetry to read as a fault.

The explanations of how the ledger treats a figure — a capital purchase recorded
as cash out, a refund recorded as negative revenue, a provisional figure that
will be replaced when the week settles, a commission that may never be determined
— SHALL be reachable from the section they govern rather than displayed
permanently beside the fields. They SHALL be reachable by tap as well as by
pointer, SHALL state whether they are open, and SHALL be dismissable from the
keyboard.

Every entry field's accessible name SHALL identify the figure unambiguously,
including which drawer movement it belongs to, whatever the visible label is
shortened to. No entry field's font size SHALL fall below the threshold at which
a mobile browser zooms the viewport on focus.

#### Scenario: A sourced aggregator offers nothing to type

- **WHEN** the owner opens the entry form for any business date
- **THEN** the sourced aggregator's group shows its figures as a reading, and carries no revenue field and no commission field

#### Scenario: A day with no figures yet still offers nothing to type

- **WHEN** the owner opens a day for which no aggregator figure has arrived
- **THEN** the group says no figure has arrived, and still carries no field for entering one

#### Scenario: An undetermined commission says so

- **WHEN** a sourced day's commission is not yet known
- **THEN** the group states the commission is not known yet, and does not present the stated revenue as the amount received

#### Scenario: A channel the ledger does not source keeps its fields

- **WHEN** the owner opens the entry form and one aggregator is sourced while another is not
- **THEN** the unsourced channel keeps its revenue and commission fields, and the form states why the two differ

#### Scenario: An explanation is asked for

- **WHEN** the reader opens a section's explanation
- **THEN** it appears without displacing the fields, reports itself as open, and can be dismissed from the keyboard

#### Scenario: A shortened label still identifies its field

- **WHEN** two drawer-movement fields present identical visible labels
- **THEN** each field's accessible name names its movement and its unit, so they are distinguishable without seeing them

### Requirement: A month reads as revenue by channel, aggregator revenue net of commission, and cash-basis profit that names its basis

For a chosen outlet and month the surface SHALL show gross revenue for each of
the four channels, aggregator revenue computed per day from that day's own
stored commission rate, expenses totalled by category, and an estimated profit.

Expenses SHALL be totalled by the **normalised category text stored on each
row**, so that two rows whose categories differ only in capitalisation or
spacing total as one line rather than as two.

Net revenue SHALL be cash revenue plus UPI revenue plus, for each aggregator
and each day, that day's stated revenue reduced by that day's own stored
commission rate. A single rate SHALL NOT be applied across a month whose days
carry different rates.

The profit figure SHALL be computed as net revenue minus every recorded expense,
and SHALL state in words beside it that it is a cash-basis operating estimate, as
`profit-estimates` requires of any profit figure. It SHALL be described as an
operating figure because capital purchases are deliberately not recorded here, so
it answers whether the outlet's trading covered its running costs and not where
every rupee went. Consumption-basis profit SHALL NOT be offered, because no stock
valuation is recorded. Aggregator commission SHALL NOT appear as an expense,
since it is already netted from revenue.

All arithmetic SHALL be performed in integer paise, and a commission reduction
SHALL round to the nearest paisa by a single stated rule so that a month's
figure is reproducible.

#### Scenario: Aggregator revenue is netted per day

- **WHEN** a month contains days whose Zomato commission rates differ
- **THEN** each day is reduced by its own stored rate and the month's net Zomato revenue is the sum of those per-day results

#### Scenario: Two spellings of one category total as one line

- **WHEN** a month contains expenses whose categories differ only in capitalisation or in surrounding or repeated whitespace
- **THEN** they are totalled as a single line in the month's breakdown rather than as separate categories

#### Scenario: The basis is named

- **WHEN** the month's estimated profit is rendered
- **THEN** the words identifying it as a cash-basis estimate appear beside the figure, and no consumption-basis figure is offered

#### Scenario: The estimate is named as an operating figure

- **WHEN** the month's estimated profit is rendered
- **THEN** it is stated as a cash-basis operating estimate, so that a reader is not led to believe it accounts for equipment or other capital spending

#### Scenario: No expense is silently excluded

- **WHEN** the month's profit estimate is computed
- **THEN** every recorded expense is subtracted, with no category or marker quietly left out, so the figure reconciles exactly against the month's expenses by category

#### Scenario: Commission is never also an expense

- **WHEN** the month's expenses by category are totalled
- **THEN** no aggregator commission is included, because it is netted from revenue instead

#### Scenario: Both outlets are read separately

- **WHEN** a month is read for one outlet
- **THEN** its figures include that outlet's rows only, and the other outlet's revenue and expenses are absent

#### Scenario: A month with no rows

- **WHEN** a month and outlet with no recorded days is opened
- **THEN** the surface states that nothing is recorded rather than showing zero as though it were a measured result

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

### Requirement: The rows recorded before categories were free text keep every word already typed into them

The conversion to free-text categories SHALL promote each already-recorded
expense's "what was it for" text to its category, and SHALL discard the
fixed-list value. The nine rows recorded between 2026-08-01 and 2026-08-06 carry
a fixed-list category that is identical on all of them and holds no information,
while the required text beside it holds the real one.

The suggestion list SHALL be seeded with the distinct promoted values, so that a
category already in nightly use is offered rather than retyped.

The conversion SHALL assert its own outcome inside the transaction that performs
it: the number of rows converted, that no row is left with a blank category, and
the number of categories seeded. A conversion that moves fewer rows than exist
SHALL fail and change nothing, because a partial conversion of the only record of
a month's trading is worse than a refused one.

#### Scenario: Every recorded row keeps its words

- **WHEN** the conversion runs against the recorded rows
- **THEN** each row's category is the text it previously carried as its description, normalised, and no row loses a word that was typed into it

#### Scenario: The suggestion list starts populated

- **WHEN** the conversion completes
- **THEN** the suggestion list holds one entry per distinct promoted category, and recording the next expense offers them

#### Scenario: A partial conversion is refused

- **WHEN** the conversion would leave any existing row with a blank category, or would convert fewer rows than exist
- **THEN** the transaction fails and every row is left exactly as it was

### Requirement: An expense may be recorded from the counter tablet, attributed to the shift's operator

A counter device session SHALL be able to record a manual-ledger expense for its
own tablet's outlet **only while it holds a live shift**, and the row SHALL be
attributed to that shift's operator, read from the shift rather than from the
request body. The device session SHALL gain no other reach over the ledger: it
SHALL NOT read or write a day record, SHALL NOT read a month's aggregate, and
SHALL NOT record an expense for a past business date.

Voiding an expense recorded this way SHALL remain governed by the rules already
in force for the outlet's staff, and a voided expense SHALL stay visible.

#### Scenario: Biller records a cash expense at the counter
- **WHEN** a tablet holding a live shift records a cash expense for today at its own outlet
- **THEN** the row is stored, attributed to the person holding that shift, and appears in the outlet's expense list

#### Scenario: No live shift
- **WHEN** a tablet with no live shift hand-crafts an expense insert
- **THEN** the database refuses it

#### Scenario: Another outlet
- **WHEN** a tablet hand-crafts an expense insert naming an outlet that is not its own
- **THEN** the database refuses it

#### Scenario: A past day
- **WHEN** a tablet hand-crafts an expense insert for an earlier business date
- **THEN** the database refuses it

#### Scenario: The body names somebody else
- **WHEN** a tablet submits an expense naming a different person as the one who recorded it
- **THEN** the stored row is attributed to the shift's operator instead

#### Scenario: The day record stays out of reach
- **WHEN** a tablet hand-crafts a read or write of a manual-ledger day record or a month aggregate
- **THEN** the database returns no rows and accepts no write

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue stays typed

Each outlet SHALL carry an explicit **billing go-live date**, null until that
outlet is promoted and set by a Super Admin. It SHALL NOT be derived from billing
data: shadow smoke-test bills are rung before any customer money, so a derived
boundary would move itself onto a day whose revenue was already typed by hand.
Setting it to a business date that has already started SHALL be refused, because a
day that begins hand-typed and ends sourced from bills is counted twice.

From that date, the manual ledger SHALL source that outlet's **cash and UPI**
revenue from paid bills rather than from a typed figure, SHALL state on screen
that each figure came from the counter, and SHALL NOT offer a second field
inviting the same money to be entered again. Where a paid bill has one or more
append-only tender corrections, the ledger SHALL use its latest accepted effective
Cash/UPI allocation and SHALL NOT count the original allocation as additional
revenue.

**An aggregator channel's revenue SHALL be sourced where `aggregator-settlement-sync`
covers it, and SHALL remain typed everywhere else**, independently of the billing
go-live date and independently of the other aggregator. V1 billing accepts Cash and
UPI only, so an aggregator order is never rung at the counter and no bill can ever
be its source; sourcing therefore comes from the settlement record and from nowhere
else. A channel with no sourced figure for a business date SHALL keep its stated
revenue field, its per-day commission amount and its computed net exactly as the
capability already defines them. A day MAY therefore read as two figures from the
counter, one from settlement and one entered by hand, each labelled for what it is.

Every other part of the ledger SHALL keep working by hand until #12 and #13
retire it: Swiggy commission, cash in and out, expenses the sync does not source,
and the counted drawer. A business date before that outlet went live SHALL keep
its typed figure exactly as recorded, and a business date before the sync covered
a channel SHALL keep that channel's typed figure and stored rate exactly as
recorded.

Sourcing an aggregator channel SHALL NOT leave a day computing a net from a rate
and no stated revenue: where a channel is sourced, its stored rate SHALL be
disregarded in favour of the measured commission, and where it is not, the rate
SHALL continue to govern.

#### Scenario: Go-live is set mid-trade
- **WHEN** a Super Admin tries to set an outlet's go-live date to a business date that outlet is already trading
- **THEN** it is refused, naming the next date that has not started, so no day is ever part typed and part billed

#### Scenario: Shadow tests before go-live
- **WHEN** test bills are rung at an outlet before its go-live date is set
- **THEN** the ledger keeps reading that outlet's typed cash and UPI revenue for those dates, because the boundary is the recorded date and not the presence of bills

#### Scenario: The night an outlet goes live
- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** cash and UPI revenue are shown as coming from the counter and are not editable there, while any unsourced aggregator revenue, its commission, the cash movements, the expenses and the drawer count are entered as before

#### Scenario: Aggregator revenue survives the handover
- **WHEN** the owner records a live outlet's day on which no aggregator channel is sourced
- **THEN** the Zomato and Swiggy groups are present with their stated revenue fields, their per-day rates and their computed net, and the day is storable with aggregator revenue and no typed cash or UPI figure

#### Scenario: One aggregator is sourced and the other is not
- **WHEN** the owner opens a day whose Zomato figures are synced and whose Swiggy figures are not
- **THEN** the Zomato group reads as a sourced figure with its settlement state, the Swiggy group offers its revenue field and rate as before, and the day's total is the sum of both

#### Scenario: An earlier month is reopened
- **WHEN** the owner opens a business date from before that outlet went live, or from before the sync covered a channel
- **THEN** every figure reads exactly as it was recorded, computed by the rule that applied on that date

