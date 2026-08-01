# attendance-and-location (delta)

## MODIFIED Requirements

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view their own outlet's attendance for a
chosen business day, showing for each person listed the check-in time, the
distance and accuracy of the reading, the source, whether it was late, whether
it is waiting for approval, and any flags, and SHALL be able to approve waiting
days and record manual entries from that view. A Super Admin SHALL be able to
view any outlet's day on the same terms, whether or not they hold an assignment
there.

**Who is listed is a question about staff.** The view SHALL list every person
holding a live **staff** assignment at that outlet, and SHALL NOT list a person
merely because they hold a manager or counter assignment there: attendance is
recorded for the people whose arrival the outlet tracks, and a manager or an
owner is not one of them. A person holding a staff assignment alongside any other
SHALL be listed, because their attendance is a real thing.

The view SHALL additionally list any person carrying a recorded row on the day
shown, whatever assignment they hold, so that every recorded day is visible and
every count computed from rows can be settled. A person whose account is
deactivated but who has not left SHALL still be listed — cutting access does not
falsify the day.

The count of days waiting for approval SHALL be stated on the view as a badge
against the business day it belongs to, so a manager learns of them without
reading every row.

The view SHALL also state whether **the outlet in scope** holds unapproved
arrivals on business days other than the one on screen, as a mark on the control
that moves to earlier days and on the control that moves to later ones. That
mark SHALL reflect only the outlet in scope: another outlet's unsettled days
SHALL NOT mark these controls.

Days waiting for approval SHALL be listed first, since they are the only rows
on this view carrying somebody else's request for attention. The order SHALL be
fixed while the view is open and recomputed when it is opened again or the
chosen day changes, so that settling a day never moves the rows beneath it.

#### Scenario: A manager opens the day

- **WHEN** a Franchise Admin opens attendance for a business day
- **THEN** every person holding a staff assignment at that outlet has their
  record for that day listed with the time, evidence, late tag and flags; rows
  waiting for approval are distinguished, counted, and listed above the rest;
  and manually entered events show who entered them

#### Scenario: A manager who is not staff is not on the roll-call

- **WHEN** a Franchise Admin holding no staff assignment at the outlet, and an
  owner holding none there either, are both live at that outlet and its
  attendance day is opened
- **THEN** neither appears on the day

#### Scenario: A manager who is also staff is on the roll-call

- **WHEN** a person holds both a Franchise Admin and a staff assignment at the
  same outlet and that outlet's attendance day is opened
- **THEN** they appear on the day like any other staff member

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

### Requirement: Attendance is readable by person over a range, not only by day

A Franchise Admin SHALL be able to select one person holding a live staff
assignment at their outlet and read every day that person worked at **that
outlet** over a chosen range of business dates, defaulting to the current month,
with a summary of how many days were present, late, absent and waiting for
approval.

A person who holds no staff assignment at the outlet SHALL NOT be offered here
even if they carry recorded rows there. Such rows are read on the business day
they belong to, which is where anybody settling one needs them; a range of days
for somebody whose days are not tracked would be a pattern of nothing.

The read SHALL name its outlet explicitly rather than resolving it from the
session, and a Franchise Admin SHALL NOT be able to obtain a person's days at
any other outlet, by the surface or by a hand-crafted request. A Super Admin
SHALL be able to read any outlet on the same terms.

A person reading their own attendance SHALL be offered the same range control,
and their own history SHALL continue to span every outlet they work or worked
at, each day naming its outlet.

#### Scenario: A manager reads one person's month

- **WHEN** a Franchise Admin selects a staff member and the current month
- **THEN** every business day in the range within that person's assignment is
  listed with its status, arrival time, late tag and approval, and the summary
  counts present, late, absent and waiting days

#### Scenario: The two views agree

- **WHEN** the same business day is read through the day view and through the
  person view
- **THEN** both show the same status, time, evidence, late tag and approval

#### Scenario: A manager cannot read another outlet's days for the same person

- **WHEN** a Franchise Admin requests a range of days for a person who also
  works at another outlet, hand-crafting the request to name that outlet
- **THEN** no rows are returned

#### Scenario: An employee reads their own month across outlets

- **WHEN** a person who works at two outlets reads their own attendance over a
  range
- **THEN** every day is listed, each naming the outlet it was worked at

### Requirement: A manager maintains the outlet's staff list

A Franchise Admin SHALL see, on their outlet's people surface, every person
holding a live assignment at that outlet — and only those people. A person
assigned to two outlets SHALL appear on both outlets' people lists, and each
manager SHALL see only the attendance rows worked at their own outlet.

The outlet's **attendance** day is a narrower list, and deliberately so: it is
the people holding a live staff assignment there, plus anybody carrying a row on
the day shown. A manager appears on their outlet's people surface always and on
its attendance day only when they are also staff there.

#### Scenario: A multi-outlet person appears on both lists

- **WHEN** a person holds live staff assignments at both outlets and each
  manager opens their own outlet's attendance day
- **THEN** the person appears on both, and each manager sees only the rows
  worked at their own outlet

#### Scenario: A manager is on the people list and not on the day

- **WHEN** a Franchise Admin holding no staff assignment at their outlet opens
  that outlet's people surface and then its attendance day
- **THEN** they appear on the people surface and not on the attendance day

#### Scenario: Ending an assignment removes them from that list only

- **WHEN** a person's assignment at one outlet is ended
- **THEN** they leave that outlet's people list and its new attendance days, and
  remain on the other outlet's
