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

Recording an expense SHALL ask for a category, an amount, a payment method and
an optional note, and no more. Every expense SHALL additionally carry an
**occurrence instant**, which SHALL be supplied by the system rather than typed:
it defaults to the moment of recording and is exposed for correction only where
the person chooses to say the spend happened earlier. It SHALL NOT become a
required fifth field.

An expense recorded without an explicit occurrence instant SHALL be treated as
having occurred when it was recorded.

#### Scenario: An ordinary expense

- **WHEN** a person records a category, an amount and a method
- **THEN** the expense is accepted and its occurrence instant is the moment of recording

#### Scenario: An expense that happened earlier

- **WHEN** a person states that a cash spend happened earlier in the evening
- **THEN** the stated instant is stored and the recording instant is retained alongside it

#### Scenario: The form is not lengthened

- **WHEN** the expense form is rendered
- **THEN** it presents four fields, with the occurrence instant reachable rather than demanded

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

### Requirement: An owner-recorded expense is visibly the owner's, and never cash

The Super Admin SHALL be able to record a non-cash expense at any outlet
without holding an assignment there. Such an expense SHALL carry the owner as
the recording person, and the expenses surface SHALL show it as the owner's
entry rather than as an indistinguishable outlet expense.

A cash expense from that path SHALL be refused by the database, not by the
form, so that the owner's remote entries are mathematically incapable of moving
an outlet's drawer.

An expense recorded by a Super Admin who does hold a Franchise Admin assignment
at that outlet is an ordinary manager expense and SHALL be unrestricted,
because that authority comes from the assignment.

#### Scenario: The owner records a UPI expense remotely

- **WHEN** a Super Admin records a UPI expense at an outlet they hold no
  assignment at
- **THEN** the expense is stored, attributed to them, and appears on that
  outlet's expenses surface marked as the owner's

#### Scenario: A remote cash expense is refused by the database

- **WHEN** a Super Admin holding no assignment at an outlet attempts to record
  a cash expense there, including by a hand-crafted request
- **THEN** the database refuses the write and the day's cash position is
  unchanged

#### Scenario: The owner's remote expense does not move the drawer

- **WHEN** a Super Admin records a non-cash expense at an outlet and that
  outlet's daily cash figures are read
- **THEN** the expected closing cash is unchanged, because only cash expenses
  move it
