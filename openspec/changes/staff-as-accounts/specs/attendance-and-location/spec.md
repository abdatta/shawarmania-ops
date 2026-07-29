# attendance-and-location — delta for staff-as-accounts

## ADDED Requirements

### Requirement: Attendance belongs to the person's account

An attendance row SHALL reference the person's account record directly, with
one row per person per business day. Rows SHALL survive the person's
departure and the account's deactivation — the days were worked — and
recorded attendance SHALL block deletion of the account it belongs to.

#### Scenario: Departure does not touch the record

- **WHEN** a person with recorded attendance is marked departed or their
  account is deactivated
- **THEN** every attendance row remains, attributed to the same person

#### Scenario: One row per person per day

- **WHEN** a second check-in is recorded for a person on a business day that
  already holds their row
- **THEN** the existing row is updated; no second row is created

### Requirement: An admin records attendance on someone's behalf

A Franchise Admin SHALL be able to record a check-in or check-out for a
person at their own outlet, and a Super Admin for a person at any outlet, at
a past or current time on the outlet's current business day — never a future
time. This is the escape hatch that keeps hard geofence blocking humane: the
phone died, the person forgot, the network was down.

A manual entry SHALL be stamped by the database with who entered it — the
enterer's id and a snapshot of their name, never client-supplied — and with a
source that names it manual. It SHALL carry no coordinates, because the admin
was not standing where the person was and fabricated evidence is worse than
none; the geofence SHALL NOT judge a manual event. The enterer stamp is the
accountability in evidence's place.

An Employee or counter-device session SHALL be refused a manual entry by the
database, not only by the absence of a control.

#### Scenario: A past-time check-in for someone else

- **WHEN** a Franchise Admin records a check-in for a person at their outlet
  with this morning's time
- **THEN** the row holds that time, source manual, and the admin's identity
  and name as enterer, stamped by the database

#### Scenario: A manual entry is visibly not a self check-in

- **WHEN** any surface renders an attendance event that was entered manually
- **THEN** it shows who entered it in place of GPS evidence, distinct from a
  phone self check-in, wherever attendance is read

#### Scenario: A future time is refused

- **WHEN** an admin attempts a manual entry with a time later than now
- **THEN** the database refuses the write

#### Scenario: A non-admin cannot fabricate a manual entry

- **WHEN** an Employee or counter-device session hand-crafts a write with
  source manual
- **THEN** the database refuses it

#### Scenario: The enterer stamp cannot be forged

- **WHEN** a manual entry is written naming some other account as its enterer
- **THEN** the stored enterer is the session that actually wrote it

### Requirement: A manager maintains the outlet's staff list

A Franchise Admin SHALL be able to list and edit the staff facts of people at
their own outlet, and a Super Admin at any outlet, on the account records
themselves — there is no separate roster. Marking a person departed SHALL
remove them from the staff list and from new attendance days while every
recorded row survives.

#### Scenario: A manager edits a person

- **WHEN** a Franchise Admin edits the job title or joining date of a person
  at their outlet
- **THEN** the account record reflects it everywhere people are shown

#### Scenario: A manager ends someone's time at the outlet

- **WHEN** a Franchise Admin marks a person as having left
- **THEN** the person leaves the staff list and is no longer offered for new
  attendance, and their recorded days remain

## MODIFIED Requirements

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view their own outlet's attendance for a
chosen business day, showing for each current staff member the check-in and
check-out times, the distance and accuracy of each reading, the source, and
any flags, and SHALL be able to act on pending overrides and record manual
entries from that view. A person whose account is deactivated but who has not
left SHALL still be listed — cutting access does not falsify the day.

#### Scenario: A manager opens the day

- **WHEN** a Franchise Admin opens attendance for a business day
- **THEN** every current staff member's record for that day is listed with
  times, evidence, and flags; rows awaiting an override are distinguished;
  and manually entered events show who entered them

#### Scenario: A manager opens a day at another outlet

- **WHEN** a Franchise Admin requests attendance rows belonging to an outlet
  other than their own
- **THEN** no rows are returned

#### Scenario: A deactivated person is still on the day

- **WHEN** a person's account is deactivated with no departure recorded
- **THEN** they remain listed on the outlet's attendance day

## REMOVED Requirements

### Requirement: An employee with no linked roster row is told what is missing

**Reason**: The state cannot exist — a signed-in employee *is* the person
record their attendance belongs to; there is no roster row to lack.

**Migration**: The `no-roster` empty states disappear from the employee
attendance surfaces; attendance reads by the session's own account id.

### Requirement: A manager maintains the employee roster

**Reason**: Replaced by "A manager maintains the outlet's staff list" — the
sentence "roster records SHALL remain distinct from app accounts" is the
assumption the owner removed on 2026-07-28, and the requirement's whole shape
was the separate table.

**Migration**: Roster rows fold onto accounts (linked rows merge; unlinked
rows get auto-provisioned accounts); the Staff surface is absorbed into the
People surface.
