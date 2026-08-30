# Manual Ledger

## Purpose

A **temporary** record of what each outlet took, spent and held in the drawer, kept by hand while billing, expenses and daily cash are not yet live. It answers two questions and no others: did the drawer balance on a given day, and did a month's trading cover its running costs. Revenue is split across cash, UPI, Zomato and Swiggy; aggregator commission is stored per day so a rate that changes mid-month is right on both sides of the change; every figure is integer paise and every derived figure is computed in one place.

This capability carries its own retirement contract. It grants no authority that outlives it, and it may be removed only by a change that first carries its rows into the live cash and expense records.

## Requirements

### Requirement: The day record is reachable by owners, and by managers at the outlets they are assigned to

The manual ledger's day record, its sourced daily aggregator figures and its
full surface SHALL be available to an account holding a live Super Admin
assignment at any outlet, and to an account holding a live Franchise Admin
assignment **at the outlets that assignment names**. A Franchise Admin SHALL be
refused every select, insert, update and delete on `manual_ledger_days` and
every select of a sourced channel day at every outlet where they do not hold a
live assignment, by Row-Level Security rather than by the interface.

A Franchise Admin's daily-figure grant SHALL NOT extend to aggregator settlement
cycles, deductions, sync runs, credentials, auth requests or owner sync
controls. A Biller or an Employee SHALL be refused every select, insert, update
and delete on `manual_ledger_days` and every sourced channel-day select at every
outlet, including outlets where they hold a live assignment. The refusal SHALL
be the absence of a policy branch, not a hidden screen.

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
- **THEN** the manual ledger appears in their navigation and opens with sourced
  aggregator figures for every outlet

#### Scenario: A manager opens the ledger at an outlet they are assigned to

- **WHEN** an account with a live Franchise Admin assignment signs in
- **THEN** the manual ledger appears for each assigned outlet and shows the day
  and month in full, including sourced Zomato and Swiggy daily figures

#### Scenario: A manager is refused another outlet's ledger by the database

- **WHEN** a Franchise Admin issues a hand-crafted request for a day row or
  sourced channel day at an outlet where they hold no live assignment
- **THEN** the database refuses it and returns no rows, with no reliance on the
  interface having hidden anything

#### Scenario: A manager cannot inspect owner settlement internals

- **WHEN** a Franchise Admin requests a cycle reconciliation, deduction, sync
  run, credential or auth request at an assigned outlet
- **THEN** the database returns no row

#### Scenario: Outlet staff are refused the day record at their own outlet

- **WHEN** a Biller or Employee issues a hand-crafted read or write against a
  day record or sourced channel day at any outlet
- **THEN** the database refuses it and returns no rows

#### Scenario: Staff cannot move the drawer figures

- **WHEN** a Biller or an Employee issues a hand-crafted update setting a day's counted cash, opening cash or cash removed at their own outlet
- **THEN** the database refuses each of them and every figure on that day is unchanged

#### Scenario: A past day and a month total stay out of reach

- **WHEN** a Biller or Employee issues a hand-crafted select for a past business
  date or month range at their outlet
- **THEN** the database returns no day or sourced channel rows

#### Scenario: The day surface is absent rather than forbidden

- **WHEN** a Biller or an Employee navigates directly to the manual-ledger path
- **THEN** no manual-ledger surface renders and no manual-ledger request is issued

#### Scenario: Losing an assignment ends access

- **WHEN** an account's assignment is ended or the account is deactivated
- **THEN** its next manual-ledger and sourced-figure request is refused without
  waiting for token expiry

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

### Requirement: The owner and a manager reach any business date on the expenses surface, and correct what they find there

An account holding a live Super Admin assignment, and an account holding a live
Franchise Admin assignment at the outlet the surface is about, SHALL reach the
expenses surface opened to **one business date at a time**, with a control that
steps to the previous date, steps to the next, and opens the platform calendar
on the date itself. Forward stepping and the calendar SHALL both stop at that
outlet's current business date, resolved through its own cutover, because the
guard refuses a future business date and a control offering one offers a
failure. The calendar SHALL offer a floor no nearer than one year before that
date; the steps SHALL continue past it, because the floor is a property of the
picker and not of the record, and no read SHALL be bounded by date.

The surface SHALL record a newly added expense against **the business date on
screen**, not against the current business date, and SHALL offer that action on a
date with no expenses recorded against it. Reaching a past day in order to record
what was missed from it is the reason this control exists.

Such an account SHALL be able to correct and withdraw **any** expense on the date
it reaches, whoever recorded it, at every outlet the assignment above names. The
surface SHALL NOT hide a correction the database would permit, and SHALL NOT
offer one it would refuse.

This SHALL be the same surface, the same list component and the same entry form
that outlet staff reach, differing only in which day control it renders, how many
business dates it requests, and whether a row offers its actions. It SHALL NOT
show revenue by any channel, opening cash, cash movements, the counted drawer,
any commission rate, any difference, or any monthly figure to any reader,
because the distinction between the two shapes is one of reach and never one of
financial truth.

A day reached this way SHALL state what was spent against it and how much of
that came from the drawer. A withdrawn expense SHALL count toward neither.

#### Scenario: The owner reaches a day three weeks back

- **WHEN** a Super Admin opens the expenses surface and steps or picks back to a business date three weeks earlier
- **THEN** that date's expenses are listed, each naming its recorder, with the day's total and its cash portion stated

#### Scenario: A manager corrects a staff member's row on a past date

- **WHEN** a Franchise Admin reaches a past business date at an outlet they are assigned to and corrects an expense recorded there by an Employee
- **THEN** the correction is accepted, and the row names the Employee as its recorder and the Franchise Admin as having corrected it

#### Scenario: An expense is added to the day on screen

- **WHEN** the owner reaches a past business date and records an expense from that day's surface
- **THEN** the expense is written against the date on screen rather than the current business date

#### Scenario: A day with nothing recorded still takes an entry

- **WHEN** the owner reaches a past business date with no expenses recorded against it
- **THEN** the surface states that nothing was recorded for that day and still offers to record one

#### Scenario: The control refuses tomorrow

- **WHEN** the shown business date is the outlet's current business date
- **THEN** the forward step is unavailable and the calendar offers no later date

#### Scenario: Staff reach the same surface without the same reach

- **WHEN** a Biller or an Employee opens the expenses surface
- **THEN** no day control is offered, the two most recent business days are listed, and no expense recorded by somebody else offers a correction or a withdrawal

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
any live attendance, billing, expense, cash or reporting row, and no live surface
SHALL read from its tables.

**The precedent clause is discharged, not inherited.** This capability's reach
was never precedent for the live drawer, and the live drawer's boundary has now
been decided on its own merits by `cash-drawer` and `identity-and-access`: a
Super Admin reaches every outlet's drawer, and what that costs is that the record
carries where they stood. That an outlet staff role may record a drawer expense
in this notebook remains no precedent for the live expense record, whose grants
are `outlet-expenses`' own to decide.

The capability SHALL be removed only by a change that first carries its rows into
the live cash and expense records, so that a period recorded here remains
readable from the real reports afterwards. That carry-over SHALL preserve, for
every row, the account that recorded it, the account that last corrected it,
whether it was voided and by whom and why, and whether it was recorded from away.
Dropping the tables without that carry-over SHALL NOT satisfy the removal.
**That removal belongs to `retire-the-manual-ledger` (#12) and is not performed
here.**

#### Scenario: No live figure moves

- **WHEN** a manual-ledger day or expense row is written, corrected or voided
- **THEN** no attendance, bill, live expense, drawer observation or live report figure changes

#### Scenario: No live surface takes a drawer belief from the notebook

- **WHEN** the cash drawer or the derived ledger statement is rendered
- **THEN** neither takes an opening, a closing or any drawer balance from a manual-ledger day row, and an outlet with no observation reads as not tracked rather than seeded from one

#### Scenario: The notebook's expenses are the live expense record until they are carried across

- **WHEN** an expense is recorded through any live Expenses surface
- **THEN** the derived ledger statement and the drawer's interval arithmetic both count it, whichever table currently holds it, reading through one relation that names the live record

#### Scenario: Retirement carries the attribution, not only the amounts

- **WHEN** the change that removes this capability runs
- **THEN** every recorded day and expense row is carried into the live records with its recording account, correcting account, void state and reason, and recorded-from-away marker intact, and the removal is incomplete until it is

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

An aggregator channel's revenue SHALL be sourced where
`aggregator-settlement-sync` covers it, independently of billing go-live and
independently of the other aggregator. V1 billing accepts Cash and UPI only, so
aggregator orders are never rung at the counter. Once this change promotes
Swiggy for an outlet, the ledger SHALL remove every writable Swiggy revenue,
rate and commission field for all dates and SHALL refuse a stale day payload
that still carries any of them rather than silently discarding it.

Before removing those fields, migration SHALL carry every existing typed Swiggy
value into read-only legacy provenance with its original values and SHALL prove
that historical day and month totals are unchanged. An authoritative daily
reader or settlement for the same outlet and date SHALL supersede that legacy
value without deleting it and SHALL be the only version included in totals. A
date not yet covered by an authoritative source SHALL continue to read its
carried legacy value, marked as such, but SHALL not become writable again.

A sourced channel with no successful figure for a date SHALL read as not yet
measured, not as zero, and SHALL offer Read again or the statement fallback only
to the Super Admin. Every other part of the ledger SHALL keep working by hand
until `retire-the-manual-ledger` (#12) retires it: cash in and out, expenses the
sync does not source and the counted drawer.

Sourcing an aggregator channel SHALL NOT leave a day computing a net from a
rate and no stated revenue: a measured row uses its exact stored gross,
commission-and-fee reduction and net; a carried legacy row uses its preserved
historical values.

#### Scenario: Go-live is set mid-trade
- **WHEN** a Super Admin tries to set an outlet's go-live date to a business date that outlet is already trading
- **THEN** it is refused, naming the next date that has not started, so no day is ever part typed and part billed

#### Scenario: Shadow tests before go-live
- **WHEN** test bills are rung at an outlet before its go-live date is set
- **THEN** the ledger keeps reading that outlet's typed cash and UPI revenue for those dates, because the boundary is the recorded date and not the presence of bills

#### Scenario: The night an outlet goes live
- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** cash and UPI revenue come from the counter, promoted aggregator
  channels come from their own records, and only the remaining cash movements,
  expenses and drawer count are entered by hand

#### Scenario: Aggregator revenue survives the handover
- **WHEN** the owner records a day after Swiggy typing is frozen but before a
  successful current Swiggy read exists
- **THEN** preserved legacy Swiggy values remain readable for historical dates,
  a new uncovered date states not yet measured, and neither case invents zero
  or reopens a money field

#### Scenario: One aggregator is sourced and the other is not
- **WHEN** a date has an authoritative Zomato figure and Swiggy has only legacy
  or not-yet-measured state
- **THEN** each channel displays its own source/state and the total includes
  only the authoritative or preserved value actually available for that channel

#### Scenario: Existing Swiggy typing survives the freeze

- **WHEN** the Swiggy handover migration completes
- **THEN** every historical Swiggy amount and total is unchanged, each value is
  retained with legacy-typed provenance, and no Swiggy revenue, rate or
  commission field remains writable

#### Scenario: Authoritative Swiggy replaces a legacy value

- **WHEN** a successful Swiggy read covers a date carrying a legacy typed value
- **THEN** the measured value alone enters totals and the legacy value remains
  visible as superseded history

#### Scenario: A failed read does not reopen typing

- **WHEN** no successful Swiggy value exists for a date after the handover
- **THEN** the ledger states not yet measured, writes no zero, and exposes no
  manual Swiggy money field

#### Scenario: A stale client is refused

- **WHEN** an old client saves a day payload containing removed Swiggy money or
  rate fields
- **THEN** the write fails clearly and no part of the day is changed

#### Scenario: An earlier month is reopened
- **WHEN** the owner or assigned Franchise Admin opens a date from before
  billing or aggregator automation went live
- **THEN** every available figure reads from its preserved historical source and
  computes by the rule recorded with that source

### Requirement: The manual ledger leaves the navigation while remaining reachable

While the derived ledger statement is being proved, the manual ledger SHALL
remain a live surface with a reachable route and its own navigation entry, and
SHALL be removed from the primary
navigation, so that the derived statement is the one a reader lands on and the
manual form remains available for comparison and as the fallback.

The fallback SHALL be the surface itself rather than a switch: no runtime
toggle, environment flag or stored setting SHALL select between the two
readings, and the gate registry SHALL remain a build-time constant.

Both surfaces SHALL be readable at the same time, so a reader may open one
business date in each and compare them.

#### Scenario: The reader lands on the derived statement

- **WHEN** a Super Admin or an assigned Franchise Admin opens the ledger from the navigation
- **THEN** the derived statement is shown, and the manual form keeps a navigation
  entry of its own under a different name so both can be open at once

#### Scenario: The fallback is reachable without remembering a route

- **WHEN** the navigation is inspected during the overlap
- **THEN** it offers both readings as separate entries, because a fallback that
  needs a typed URL is not one

#### Scenario: The manual form is still reachable

- **WHEN** the manual ledger's route is opened directly
- **THEN** it renders in full, with its rows and its entry fields unchanged

#### Scenario: No runtime switch exists

- **WHEN** the application is inspected for a control selecting between the two ledgers
- **THEN** none exists in configuration, storage or the interface
