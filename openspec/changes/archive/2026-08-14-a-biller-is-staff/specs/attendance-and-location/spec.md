# Delta: attendance-and-location

## ADDED Requirements

### Requirement: A staff assignment, for attendance, is Employee or Biller

Every requirement in this capability that turns on a **staff assignment** SHALL
read that term as a live `employee` **or** `biller` assignment at the outlet in
question. Attendance is recorded for the people whose arrival an outlet tracks,
and somebody who works a shift on its counter tablet is one of them.

This restates for attendance what `identity-and-access` already requires of the
assignment itself: a live Biller assignment confers personal attendance and
Employee surface capabilities at that outlet, and promoting an Employee to
Biller leaves their attendance history unchanged. The term SHALL be stated as
the roles it admits rather than as the roles it excludes, so that a role added
to the enum later joins no outlet's attendance list until somebody decides that
it should.

A Franchise Admin or Super Admin assignment SHALL NOT by itself make its holder
staff anywhere, and holding one alongside a staff assignment SHALL NOT take that
staff assignment away.

#### Scenario: A Biller is on the outlet's attendance day

- **WHEN** a person holding a live Biller assignment and no Employee assignment
  at an outlet is read on that outlet's attendance day, on a date they carry no
  record
- **THEN** they are listed as staff whose arrival is expected, on the same terms
  as an Employee, and not as somebody off the staff list

#### Scenario: A Biller is offered by the by-staff axis

- **WHEN** a reader selects an outlet where a person holds a live Biller
  assignment and reads by staff
- **THEN** that person is offered, and their range reads on the same terms as an
  Employee's

#### Scenario: Promotion from Employee to Biller keeps the person on the list

- **WHEN** an Employee is changed to Biller at the same outlet, ending the
  Employee assignment on the day of the change
- **THEN** they remain on that outlet's attendance day and in its by-staff axis
  without interruption, and every day they worked under either assignment stays
  listed and readable

#### Scenario: A manager is still not staff

- **WHEN** a person holding only a live Franchise Admin assignment at an outlet
  is read on that outlet's attendance day
- **THEN** they are not listed, and holding the manager assignment alongside a
  Biller assignment at that outlet SHALL list them

#### Scenario: A Biller accounted for elsewhere is not read as absent

- **WHEN** a person holding a live Biller assignment at the reader's outlet
  holds that day's attendance row at an outlet outside the reader's scope
- **THEN** they read as working at another outlet, without the outlet being
  named, and SHALL NOT read as absent or as not yet arrived

## MODIFIED Requirements

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view attendance for a chosen business day
across one or more of the outlets they hold a live assignment at, showing for
each person listed the check-in time, the
distance and accuracy of the reading, the source, whether it was late, whether
it is waiting for approval, and any flags, and SHALL be able to approve waiting
days and record manual entries from that view. A Super Admin SHALL be able to
view any outlets on the same terms, whether or not they hold an assignment there.

Where more than one outlet is in scope, each listed row SHALL name the outlet it
belongs to, and a person appearing at one of the selected outlets SHALL be listed
once rather than once per outlet.

**Who is listed is a question about staff.** The view SHALL list every person
holding a live **staff** assignment at an outlet in scope — an Employee or a
Biller — and SHALL NOT list a person merely because they hold a manager
assignment there: attendance is recorded for the people whose arrival the outlet
tracks, and a manager or an owner is not one of them. A person holding a staff
assignment alongside any other SHALL be listed, because their attendance is a
real thing.

The view SHALL additionally list any person carrying a recorded row on the day
shown, whatever assignment they hold, so that every recorded day is visible and
every count computed from rows can be settled. A person whose account is
deactivated but who has not left SHALL still be listed — cutting access does not
falsify the day.

The count of days waiting for approval SHALL be stated on the view as a badge
against the business day it belongs to, so a manager learns of them without
reading every row.

The view SHALL also state whether **the outlets in scope** hold unapproved
arrivals on business days other than the one on screen, as a mark on the control
that moves to earlier days and on the control that moves to later ones. That
mark SHALL reflect only the outlets in scope: an outlet outside the selection
SHALL NOT mark these controls.

Days waiting for approval SHALL be listed first, since they are the only rows
on this view carrying somebody else's request for attention. The order SHALL be
fixed while the view is open and recomputed when it is opened again or the
chosen day changes, so that settling a day never moves the rows beneath it.

**A row SHALL open onto its detail rather than render it.** Each listed row
SHALL show, without being opened, who it is about and what the day counts as;
the check-in time, the evidence, the approval and the row's actions SHALL be
reachable by opening it. A row **waiting for approval SHALL be open when the
view is opened**, since it is the row asking for a decision and approving is
what the view exists for. Whether a row is open SHALL be the reader's own state:
settling a day SHALL NOT close it. A row with no evidence, no approval and no
action SHALL offer nothing to open.

#### Scenario: A settled day is a headline until it is opened

- **WHEN** a Franchise Admin opens a business day holding an approved arrival
- **THEN** that row shows the person and the day's verdict, its evidence and
  approval are not shown, and opening the row shows them

#### Scenario: A waiting day is already open

- **WHEN** a Franchise Admin opens a business day holding an unapproved arrival
- **THEN** that row is open, with its evidence and its approve action shown
  without any further step

#### Scenario: Settling a day does not close it

- **WHEN** a Franchise Admin approves a waiting row
- **THEN** the row stays open and shows the approval that was just recorded

#### Scenario: A day with nothing recorded offers nothing to open

- **WHEN** a business day is read for a person carrying no row, on a day where
  no arrival may be entered
- **THEN** the row states what the day reads as and offers no way to open it

#### Scenario: A manager opens the day

- **WHEN** a Franchise Admin opens attendance for a business day
- **THEN** every person holding a staff assignment at that outlet has their
  record for that day listed with the time, evidence, late tag and flags; rows
  waiting for approval are distinguished, counted, and listed above the rest;
  and manually entered events show who entered them

#### Scenario: Two outlets are read together

- **WHEN** a reader who may see two outlets selects both and opens a business day
- **THEN** one list is shown covering both, each row naming its outlet, and a
  person who attended one of them appears once

#### Scenario: A manager who is not staff is not on the roll-call

- **WHEN** a Franchise Admin holding no staff assignment at the outlet, and an
  owner holding none there either, are both live at that outlet and its
  attendance day is opened
- **THEN** neither appears on the day

#### Scenario: A manager who is also staff is on the roll-call

- **WHEN** a person holds both a Franchise Admin and a staff assignment at the
  same outlet and that outlet's attendance day is opened
- **THEN** they appear on the day like any other staff member

#### Scenario: A Biller with no Employee assignment is on the roll-call

- **WHEN** a person holds a live Biller assignment and no Employee assignment at
  the outlet, and that outlet's attendance day is opened
- **THEN** they are listed as staff, whether or not they carry a record on the
  day, and are not marked as off the staff list

#### Scenario: A recorded row is listed even for somebody off the staff list

- **WHEN** a person carrying a recorded arrival on the day shown holds no staff
  assignment at that outlet
- **THEN** they are listed for that day with their row, and a row of theirs
  waiting for approval can be approved from the view

#### Scenario: Settling a day does not move the list

- **WHEN** a Franchise Admin approves a waiting day while others are still
  waiting
- **THEN** the approved row keeps its position and shows its new state, and the
  rows beneath it do not move

#### Scenario: Earlier days hold unsettled work

- **WHEN** the outlet in scope has unapproved arrivals on a business day before
  the one on screen
- **THEN** the control that moves to earlier days is marked

#### Scenario: Another outlet's backlog does not mark the day controls

- **WHEN** the outlet in scope has no unapproved arrivals on any other day, and
  a different outlet does
- **THEN** neither day control is marked

#### Scenario: The day on screen is the only one waiting

- **WHEN** the outlet in scope has unapproved arrivals on the day on screen and
  on no other day
- **THEN** the day carries its count and neither day control is marked
