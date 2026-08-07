# Manual Ledger

## Purpose

A **temporary** owner-only record of what each outlet took, spent and held in the drawer, kept by hand while billing, expenses and daily cash are not yet live. It answers two questions and no others: did the drawer balance on a given day, and did a month's trading cover its running costs. Revenue is split across cash, UPI, Zomato and Swiggy; aggregator commission is stored per day so a rate that changes mid-month is right on both sides of the change; every figure is integer paise and every derived figure is computed in one place.

This capability carries its own retirement contract. It grants no authority that outlives it, and it may be removed only by a change that first carries its rows into the live cash and expense records.

## Requirements

### Requirement: The manual ledger is reachable only by an owner, and the database is what refuses everyone else

The manual ledger surface and both of its tables SHALL be available only to an
account holding a live Super Admin assignment. A Franchise Admin, Biller or
Employee SHALL receive no navigation entry, no route and no rendered surface,
and SHALL be refused every select, insert, update and delete on both tables by
Row-Level Security rather than by the interface.

The refusal SHALL hold at every outlet, so that an outlet role is refused its
own outlet's manual-ledger rows as firmly as another outlet's. Deactivating an
account or ending its Super Admin assignment SHALL end that access on the
account's next request.

#### Scenario: An owner opens the ledger

- **WHEN** an account with a live Super Admin assignment signs in
- **THEN** the manual ledger appears in their navigation and opens for either outlet

#### Scenario: An outlet role is refused by the database

- **WHEN** a Franchise Admin, Biller or Employee issues a hand-crafted select or insert against either manual-ledger table, naming an outlet where they hold a live assignment
- **THEN** the database refuses it and returns no rows, with no reliance on the interface having hidden anything

#### Scenario: The surface is absent rather than forbidden

- **WHEN** a non-owner navigates directly to the manual-ledger path
- **THEN** no manual-ledger surface renders and no manual-ledger request is issued

#### Scenario: Losing the owner role ends access

- **WHEN** an account's Super Admin assignment is ended or the account is deactivated
- **THEN** its next manual-ledger request is refused without waiting for token expiry

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

The ledger SHALL record at most one day row per outlet per business date,
enforced by a uniqueness constraint in the database. Each row SHALL hold, in
integer paise: revenue received as cash, as UPI, through Zomato and through
Swiggy; cash brought into the drawer; cash taken out of the drawer; opening
cash; and the drawer count at close. It SHALL also hold a reason for any
non-zero cash movement, an optional free-text note, and the Zomato and Swiggy
commission rates that applied to that day.

Money SHALL be integer paise throughout, and commission SHALL be an integer
basis-point value, so that no figure on this surface is ever a float. The
business date SHALL be an explicit `date` column and SHALL NOT be derived from
a timestamp when read.

A negative revenue figure SHALL be permitted, because a cash refund is recorded
by reducing that day's cash revenue. A negative opening cash, drawer count,
cash-in or cash-out figure SHALL be refused, as SHALL a future business date
and a commission rate outside nought to ten thousand basis points.

#### Scenario: A day is recorded for one outlet

- **WHEN** the owner records revenue across four channels, a drawer count and any cash movements for an outlet and business date
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

- **WHEN** a negative drawer count, negative opening cash, negative cash movement, future business date or out-of-range commission rate is submitted by a hand-crafted request
- **THEN** the database refuses the write

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

Each day row SHALL store its own Zomato commission rate, Swiggy commission rate
and opening cash as stored values rather than deriving them when read. When the
entry form opens for a new day, it SHALL offer as defaults the commission rates
from that outlet's most recent earlier day row and the counted cash from that
outlet's immediately preceding day row, and each default SHALL remain editable.

Editing an existing day's commission rate, counted cash or any other figure
SHALL change only that day. It SHALL NOT alter any other day's stored opening
cash, commission rate, expected cash or difference.

Where a day's stored opening cash disagrees with the immediately preceding day
row's counted cash, the surface SHALL show that disagreement as a read-only
signal beside the day. It SHALL NOT repair the figure, because a stored figure
the owner entered is evidence and a recomputed one is not.

#### Scenario: A new day inherits the previous day's close

- **WHEN** the owner opens the form for a business date following an existing day row at that outlet
- **THEN** opening cash is offered as that preceding row's counted cash and both commission rates are offered from the most recent earlier row, all editable

#### Scenario: The first tracked day is seeded by hand

- **WHEN** the owner records the first day row for an outlet, with no earlier row to inherit from
- **THEN** opening cash and both commission rates are required entries with no inherited default

#### Scenario: Correcting an old day leaves later days alone

- **WHEN** the owner edits the counted cash or commission rate on a day that has later day rows at the same outlet
- **THEN** only that day's stored figures, expected cash and difference change, and every later day's stored opening cash, commission rate, expected cash and difference are byte-for-byte unchanged

#### Scenario: A broken chain is visible

- **WHEN** a day's stored opening cash differs from the preceding day row's counted cash
- **THEN** the surface shows the disagreement beside that day and changes no stored figure

#### Scenario: A retrospective commission edit moves no cash figure

- **WHEN** the owner changes a past day's Zomato or Swiggy commission rate
- **THEN** that day's net aggregator revenue and the month's profit change, while its expected cash, counted cash and difference are unchanged

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

Each aggregator's stated revenue SHALL be presented together with the commission
rate stored against that day, as one group, and that group SHALL show what was
actually received, computed as the figures are typed through the same rounding
rule the month uses. Where no rate has been given, the group SHALL show that
there is nothing to compute rather than showing nil.

The explanations of how the ledger treats a figure — a rate held per day, a
capital purchase recorded as cash out, a refund recorded as negative revenue —
SHALL be reachable from the section they govern rather than displayed
permanently beside the fields. They SHALL be reachable by tap as well as by
pointer, SHALL state whether they are open, and SHALL be dismissable from the
keyboard.

Every entry field's accessible name SHALL identify the figure unambiguously,
including which aggregator or which drawer movement it belongs to, whatever the
visible label is shortened to. No entry field's font size SHALL fall below the
threshold at which a mobile browser zooms the viewport on focus.

#### Scenario: An aggregator's result is visible while it is being entered

- **WHEN** a stated aggregator figure is typed and a rate is present for that day
- **THEN** the amount actually received is shown in that aggregator's group, matching what the month would compute for the same figures

#### Scenario: No rate means no figure

- **WHEN** a stated aggregator figure is typed on a day carrying no commission rate
- **THEN** the group shows that there is nothing to compute, and does not show nil as though it were a result

#### Scenario: An explanation is asked for

- **WHEN** the reader opens a section's explanation
- **THEN** it appears without displacing the fields, reports itself as open, and can be dismissed from the keyboard

#### Scenario: A shortened label still identifies its field

- **WHEN** two aggregator groups present fields with identical visible labels
- **THEN** each field's accessible name names its aggregator and its unit, so the groups are distinguishable without seeing them

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


### Requirement: The manual ledger grants no authority that survives it, and its rows outlive its surface

The manual ledger SHALL be a record only. It SHALL NOT read, write or influence
any live attendance, billing, expense, inventory, cash or reporting row, and no
live surface SHALL read from its tables. An owner's ability to write cash
figures here SHALL NOT be taken as precedent for the live cash record, whose
boundary (a Super Admin may not record a cash expense, a withdrawal or a day
close at an outlet remotely) remains as documented.

The capability SHALL be removed only by a change that first carries its rows
into the live cash and expense records, so that a month recorded here remains
readable from the real reports afterwards. Dropping the tables without that
carry-over SHALL NOT satisfy the removal.

#### Scenario: No live figure moves

- **WHEN** a manual-ledger day or expense row is written, edited or removed
- **THEN** no attendance, bill, live expense, inventory, cash record or live report figure changes

#### Scenario: No live surface reads the notebook

- **WHEN** the live cash, expense or owner-console surfaces are rendered
- **THEN** none of them queries a manual-ledger table

#### Scenario: The owner's live cash boundary is unchanged

- **WHEN** a Super Admin attempts a cash expense, a withdrawal or a day close at an outlet through the live path
- **THEN** the database refuses it exactly as before, unaffected by this capability existing

#### Scenario: Retirement carries the rows first

- **WHEN** the change that removes this capability runs
- **THEN** every recorded day and expense row is carried into the live cash and expense records before the tables are dropped, and the removal is incomplete until it is

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
