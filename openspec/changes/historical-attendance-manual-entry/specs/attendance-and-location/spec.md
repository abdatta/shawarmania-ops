# Delta: attendance-and-location

## MODIFIED Requirements

### Requirement: No check-in by the deadline reads absent

A person holding an Employee or Biller assignment SHALL read as absent on every
attendance surface once the applicable outlet arrival deadline for a business
day in that assignment window has passed with no attendance row recorded for
them anywhere that day. Before the deadline has passed, the same person SHALL
read as not yet arrived.

Absence SHALL be judged once per person per business date, never once per outlet.
A person carrying a row at one outlet SHALL NOT read as absent at another on the
same date, on any surface or in any count. A stored row SHALL always take
precedence.

This state SHALL remain derived from stored rows, outlet clocks and assignment
windows. No scheduled process SHALL manufacture attendance rows. On the
manager's day view, a row-less day SHALL appear only where an Employee or Biller
assignment at a selected outlet covers that business date; a current staff
member SHALL NOT be shown absent before starting there or after that assignment
ended.

#### Scenario: A current staff member missed a past deadline

- **WHEN** a manager opens a past business day covered by a current visible
  staff member's Employee or Biller assignment and no row exists anywhere
- **THEN** that person reads as absent once, with the missed deadline stated

#### Scenario: The selected day precedes employment

- **WHEN** a current staff member's assignment started after the selected
  business date and no earlier staff assignment covers it
- **THEN** the manager's day does not show them absent or offer an attendance
  action for that date

#### Scenario: No row is invented by time passing

- **WHEN** any number of business days pass with nobody checking in
- **THEN** no attendance row exists until an authorised person deliberately
  records or corrects attendance

### Requirement: An admin records attendance on someone's behalf

A Franchise Admin SHALL be able to use **Record arrival** for a current visible
staff member at their own outlet, and a Super Admin at any outlet in scope, on
the outlet's current or a past business date—never a future date. The person
SHALL have held an Employee or Biller assignment at that outlet on the named
business date. A date before the assignment began, after its historical window
ended, or at another outlet SHALL be refused by the database.

The action SHALL be the same on every eligible date: it asks when the person
arrived, and where more than one selected outlet was an eligible staff outlet on
that date it also asks which outlet. The asserted instant SHALL be in the past
or present and SHALL belong to the explicit named business date under that
outlet's cutover. The database SHALL refuse a future instant or an instant that
belongs to a different business date.

A successful manual entry SHALL append one immutable manual attempt and one
`manual_present` decision, stamp the acting session's id and name as enterer and
actor, carry no coordinates, and settle the day without a second approval. The
sheet SHALL state the selected business date; a past entry SHALL not be
described as today's. The action SHALL require no reason and SHALL read no
manager position.

An Employee, Biller device, unauthorised Franchise Admin, forged enterer or
second person-day at any outlet SHALL remain refused by the database. Exact
successful command replay SHALL create no duplicate attempt or decision.

#### Scenario: A past derived absence is recorded present

- **WHEN** an authorised manager opens an eligible past derived-absent row,
  presses **Record arrival**, supplies a time belonging to that business date
  and submits **Record it under my name**
- **THEN** the row becomes one settled present day with that asserted time,
  source manual, the database-stamped manager identity, no GPS evidence and no
  waiting approval

#### Scenario: Today's process is unchanged

- **WHEN** an authorised manager records an arrival on the outlet's current
  business date
- **THEN** the same button, time field, attribution, no-location evidence and
  settled result are used

#### Scenario: The arrival instant belongs to another business date

- **WHEN** a hand-crafted manual-entry command names one explicit business date
  but supplies an instant that the outlet cutover places on another
- **THEN** the database refuses the command and writes no attendance, attempt or
  decision row

#### Scenario: The person had not joined that outlet

- **WHEN** a manager hand-crafts a manual entry for a date outside the person's
  Employee/Biller assignment window at the target outlet
- **THEN** the database refuses it even if the person is staff there today

#### Scenario: Another outlet already owns the person-day

- **WHEN** the person already carries attendance at another outlet on the named
  business date
- **THEN** no **Record arrival** action is offered where that fact is known, a
  handcrafted second entry is refused, and the existing row remains unchanged

#### Scenario: The enterer remains the writing session

- **WHEN** an authorised manager records a historical arrival while naming
  another account as the convenience enterer input
- **THEN** the attempt and decision name the authenticated writing manager and
  preserve the separately database-stamped decision time
