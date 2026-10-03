# Outlet Expenses

## Purpose

What an outlet spent, against an explicit business date, in integer paise. The rule that gives this capability its weight is the one connecting it to the drawer: **only a cash expense reduces the cash a manager counts at close**, and one paid by UPI or card is real money that never left the till. Everything else here — the four fields, the day at a time, the cash marker — exists to keep that distinction legible at the moment somebody is reconciling.

## Requirements

### Requirement: One expense record, promoted from the notebook rather than migrated into an empty table

The business SHALL hold exactly one expense table. It SHALL be the table that
already carries the production rows, promoted by rename, and the unused table
created alongside the original demo surfaces SHALL be dropped.

The promoted record SHALL retain, without reimplementation, every property the
notebook's expense row accumulated: a free-text category snapshot, an explicit
`business_date`, an occurrence instant, integer paise, a cash or non-cash
method, the account that recorded it, the account that last corrected it, the
void state with its actor and reason, and whether it was recorded by somebody
holding no assignment at that outlet.

No expense row SHALL be copied between tables, because copying is what loses the
properties above.

#### Scenario: The rows survive in place

- **WHEN** the promotion runs
- **THEN** every existing expense row keeps its identity, category text, attribution, void state and recorded-from-away marker, and no row is inserted or deleted

#### Scenario: The empty table is gone

- **WHEN** the schema is inspected afterwards
- **THEN** exactly one expense table exists and nothing references the dropped one

#### Scenario: Staff correction rules are unchanged by the promotion

- **WHEN** a staff member corrects their own expense on the day they recorded it
- **THEN** it behaves exactly as it did before the promotion, and a correction outside that window is refused as before

### Requirement: The consumption basis names a category that exists, or does not exist at all

Any reporting basis that identifies stock spending by category SHALL match
against the category text the promoted table actually holds. A basis that
matches a value from a closed list nothing types any more SHALL NOT remain in
place quietly matching nothing; it SHALL either be corrected to match real
categories or withdrawn.

#### Scenario: A basis that matches nothing is not left standing

- **WHEN** the reporting bases are evaluated after the promotion
- **THEN** no basis silently returns zero because it matches a category no person can type

### Requirement: The expenses surface shows one business day at a time

The expenses surface SHALL list the expenses recorded against a single
business date for one outlet, most recent first, each showing its category,
amount, payment method and description. The category SHALL be shown as the text
stored on the row rather than as a label looked up from the live suggestion
list, so that renaming or retiring a category cannot re-label a recorded
expense. The business date SHALL be shown as a date and SHALL be selectable,
never derived from the device clock at read time.

#### Scenario: Reading a day's expenses

- **WHEN** a Franchise Admin opens the expenses surface
- **THEN** the expenses for the shown business date are listed with category, amount, payment method and description

#### Scenario: A day with no expenses

- **WHEN** the shown business date has no expenses recorded
- **THEN** an empty state states what to record, rather than reporting no data

#### Scenario: A retired category still reads on the rows that used it

- **WHEN** a category is retired from the suggestion list after expenses were recorded under it
- **THEN** those expenses still show that category on the day's list, unchanged

### Requirement: Cash expenses are visually distinct from every other method

An expense paid in cash SHALL be marked distinctly from expenses paid by any
other method, using a text label in addition to any colour, because cash
expenses alone reduce the drawer that is counted at close.

#### Scenario: A mixed day

- **WHEN** the list contains both a cash expense and a UPI expense
- **THEN** the cash expense carries a distinguishing label that the UPI expense does not

### Requirement: Recording an expense takes four fields and no more

Recording an expense SHALL ask for a category, an amount, a payment method and an
optional note, and no more. Recording one through the staff or counter route SHALL
ask for a category, an amount and an optional note, and SHALL state that the
expense is cash out of the drawer, since nothing else may be recorded there.

The owner or a manager recording a new expense SHALL choose the payment method
explicitly. The method SHALL start unchosen, and the form SHALL refuse to save
until one is chosen. Correcting an existing expense SHALL start from the method it
already has.

Every expense SHALL additionally carry an **occurrence instant**, supplied by the
system rather than typed. It defaults to the moment of recording and is exposed
for correction only where the person chooses to say the spend happened earlier.
It SHALL NOT become a required extra field.

An expense recorded without an explicit occurrence instant SHALL be treated as
having occurred when it was recorded.

#### Scenario: An ordinary expense

- **WHEN** the owner or a manager records a category, an amount and a chosen method
- **THEN** the expense is accepted and its occurrence instant is the moment of
  recording

#### Scenario: The method is never pre-chosen for the owner or a manager

- **WHEN** the owner or a manager opens the form for a new expense
- **THEN** the payment method shows no choice, and submitting without choosing one
  is refused with a sentence asking how it was paid, before anything is sent

#### Scenario: A correction keeps the method already chosen

- **WHEN** the owner or a manager opens an existing UPI expense to correct it
- **THEN** the form shows UPI as its method

#### Scenario: Staff record three fields

- **WHEN** a Biller, an Employee or the counter tablet opens the expense form
- **THEN** it asks for a category, an amount and an optional note, presents no
  payment method, and records a cash expense

#### Scenario: An expense that happened earlier

- **WHEN** a person states that a cash spend happened earlier in the evening
- **THEN** the stated instant is stored and the recording instant is retained
  alongside it

#### Scenario: The form is not lengthened

- **WHEN** the expense form is rendered
- **THEN** it presents no more than four fields, with the occurrence instant
  reachable rather than demanded

### Requirement: Only cash expenses move the day's cash position

Only an expense whose payment method is cash SHALL affect any drawer figure. A
non-cash expense SHALL count toward the day's and the month's expense totals and
SHALL move no drawer balance.

A cash expense SHALL belong to a drawer interval by its occurrence instant,
falling back to its recording instant where none was stated, so that a spend
before a count and a spend after one land on opposite sides of that count.

A cash expense whose occurrence instant falls inside an interval that has already
been observed SHALL raise the drawer's reconciliation exception rather than
altering the observation.

#### Scenario: A UPI expense leaves the drawer alone

- **WHEN** a UPI expense is recorded
- **THEN** the expenses total rises and no drawer balance changes

#### Scenario: A cash expense before and after a count

- **WHEN** one cash expense occurs at 18:10 and another at 23:00, with a count at 22:00
- **THEN** the first is inside that count's interval and the second is not

#### Scenario: A cash expense backdated into an observed interval

- **WHEN** a cash expense is recorded with an occurrence instant before the most recent observation
- **THEN** the observation is unchanged and an exception reports the expense against it

### Requirement: An owner-recorded expense is visibly the owner's, and a remote drawer spend is marked

The Super Admin SHALL be able to record an expense of either method at any outlet
without holding an assignment there. Such an expense SHALL carry the owner as the
recording person.

A remote **cash** expense SHALL be marked on the expenses surface as entered from
away. It moves the drawer the counter is accountable for, and the marking is what
tells them. A remote non-cash expense SHALL carry the recorder's name alone.

An expense recorded by a Super Admin who does hold a Franchise Admin assignment at
that outlet is an ordinary manager expense.

#### Scenario: The owner records a UPI expense remotely

- **WHEN** a Super Admin records a UPI expense at an outlet they hold no
  assignment at
- **THEN** the expense is stored, attributed to them, and does not move that
  outlet's expected drawer cash

#### Scenario: The owner records a drawer expense remotely

- **WHEN** a Super Admin holding no assignment at an outlet records a cash expense
  there
- **THEN** the expense is stored, lowers the expected drawer cash, and is marked as
  entered from away

### Requirement: Outlet staff reach only the expenses that leave the drawer

A Biller or Employee SHALL read, record and correct only cash expenses at the
outlets they are assigned to. A counter tablet holding a live shift SHALL read and
record only cash expenses at its outlet. An expense paid by any other method SHALL
be invisible to them. The database SHALL enforce this, not the screen, so it holds
against a hand-crafted request with a valid session.

The restriction SHALL apply only through the staff and counter routes. A manager
at the outlet, and the owner, SHALL read every expense there as before.

A refused write SHALL return a sentence naming who records the rest, so a queued
counter expense refused after it was written carries words the operator can act
on.

Narrowing staff reads SHALL NOT change any drawer figure.

#### Scenario: A salary paid by transfer is not readable by staff

- **WHEN** the owner records a non-cash Salary expense at an outlet, and a Biller
  assigned there requests that outlet's expenses for that day by a hand-crafted
  request
- **THEN** the salary is absent from the response, and a cash expense on the same
  day is present

#### Scenario: The counter tablet sees the drawer's expenses only

- **WHEN** a tablet holding a live shift lists its outlet's expenses on a day
  holding a cash purchase, a Hyperpure order and a non-cash rent payment
- **THEN** only the cash purchase is returned

#### Scenario: Staff cannot record a non-cash expense

- **WHEN** an Employee, or a tablet holding a live shift, inserts an expense that
  is not cash at their own outlet
- **THEN** the database refuses it, saying staff record only what leaves the
  drawer and a manager or the owner records the rest

#### Scenario: Staff cannot turn their own cash expense into a non-cash one

- **WHEN** a Biller corrects their own cash expense on the running day and sets it
  to non-cash
- **THEN** the database refuses the correction and the row is unchanged

#### Scenario: A manager still reads everything

- **WHEN** a Franchise Admin lists the expenses of an outlet they are assigned to
- **THEN** cash and non-cash expenses are both returned

#### Scenario: The drawer is unchanged by the narrowing

- **WHEN** an outlet's expected drawer cash is read before and after this rule
  applies, over the same rows
- **THEN** the figure is identical

#### Scenario: A cash advance stays visible by decision

- **WHEN** a manager records a cash expense from the drawer for a salary advance
- **THEN** staff at that outlet read it like any other cash expense
