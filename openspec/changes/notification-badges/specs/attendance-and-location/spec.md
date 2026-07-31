## MODIFIED Requirements

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view their own outlet's attendance for a
chosen business day, showing for each current staff member the check-in time,
the distance and accuracy of the reading, the source, whether it was late,
whether it is waiting for approval, and any flags, and SHALL be able to
approve waiting days and record manual entries from that view. A person whose
account is deactivated but who has not left SHALL still be listed — cutting
access does not falsify the day.

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
- **THEN** every current staff member's record for that day is listed with
  the time, evidence, late tag and flags; rows waiting for approval are
  distinguished, counted, and listed above the rest; and manually entered
  events show who entered them

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

### Requirement: Days waiting for approval are visible to the owner across outlets

A Super Admin SHALL be able to see, without opening each outlet in turn, how
many days are waiting for approval at each outlet. A day nobody settles is
otherwise invisible until somebody queries their pay.

Each outlet holding unsettled days SHALL be shown with its own count. Choosing
one SHALL bring the view to that outlet, so noticing a stranded day and acting
on it are one gesture rather than a count followed by hunting through a picker.
The outlet already in scope SHALL be shown as such rather than offered as
somewhere to go.

This count is across every business day, and is therefore not the same as the
waiting count for the day on screen: an outlet may hold nothing today and a
week of unsettled days behind it.

#### Scenario: The owner sees where days are stranded

- **WHEN** a Super Admin opens attendance and two outlets each hold waiting
  days
- **THEN** each outlet is shown with its own count of unsettled days

#### Scenario: The owner follows a stranded count to its outlet

- **WHEN** a Super Admin chooses an outlet other than the one in scope from
  that list
- **THEN** the attendance view moves to that outlet, and the outlet in scope is
  not offered as a destination

#### Scenario: A manager sees only their own

- **WHEN** a Franchise Admin opens attendance
- **THEN** no other outlet's unsettled days are shown to them
