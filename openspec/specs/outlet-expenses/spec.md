# Outlet Expenses

## Purpose

What an outlet spent, against an explicit business date, in integer paise. The rule that gives this capability its weight is the one connecting it to the drawer: **only a cash expense reduces the cash a manager counts at close**, and one paid by UPI or card is real money that never left the till. Everything else here — the four fields, the day at a time, the cash marker — exists to keep that distinction legible at the moment somebody is reconciling.

## Requirements

### Requirement: The expenses surface shows one business day at a time

The expenses surface SHALL list the expenses recorded against a single
business date for one outlet, most recent first, each showing its category,
amount, payment method and description. The business date SHALL be shown as a
date and SHALL be selectable, never derived from the device clock at read
time.

#### Scenario: Reading a day's expenses

- **WHEN** a Franchise Admin opens the expenses surface
- **THEN** the expenses for the shown business date are listed with category, amount, payment method and description

#### Scenario: A day with no expenses

- **WHEN** the shown business date has no expenses recorded
- **THEN** an empty state states what to record, rather than reporting no data

### Requirement: Cash expenses are visually distinct from every other method

An expense paid in cash SHALL be marked distinctly from expenses paid by any
other method, using a text label in addition to any colour, because cash
expenses alone reduce the drawer that is counted at close.

#### Scenario: A mixed day

- **WHEN** the list contains both a cash expense and a UPI expense
- **THEN** the cash expense carries a distinguishing label that the UPI expense does not

### Requirement: Recording an expense takes four fields and no more

Adding an expense SHALL ask for a category, an amount, a payment method and an
optional description, and nothing else. The amount SHALL be entered in rupees
and converted to integer paise at the boundary.

#### Scenario: Recording a cash expense

- **WHEN** a Franchise Admin records an expense with a category, an amount in rupees and the cash method
- **THEN** the expense is added to the day's list, and the amount passed to the data layer is integer paise

#### Scenario: An expense with no amount

- **WHEN** an expense is submitted with a blank or non-numeric amount
- **THEN** the write is refused with a sentence naming the amount, and nothing is recorded

### Requirement: Only cash expenses move the day's cash position

An expense's effect on the day's cash figures SHALL depend on its payment
method: an expense paid in cash SHALL reduce the day's cash position, and an
expense paid by any other method SHALL NOT.

#### Scenario: A UPI expense

- **WHEN** an expense paid by UPI is recorded for a business date
- **THEN** the day's cash expenses figure is unchanged

#### Scenario: A cash expense

- **WHEN** an expense paid in cash is recorded for a business date
- **THEN** the day's cash expenses figure increases by exactly that amount

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
