## ADDED Requirements

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

## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: An owner-recorded expense is visibly the owner's, and never cash`
- TO: `### Requirement: An owner-recorded expense is visibly the owner's, and a remote drawer spend is marked`
