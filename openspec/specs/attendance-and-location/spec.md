# Attendance And Location

## Purpose

Makes a disputed check-in reviewable instead of a black box: every attendance row can store the captured coordinates, GPS accuracy, computed distance, and source beside the verdict, and overrides record who, when, and why. Check-in flows, geofence evaluation, and override approval arrive with the attendance change; these requirements bind what the schema records.

## Requirements

### Requirement: Attendance stores the evidence beside the verdict

Every attendance row SHALL be able to record, for check-in and check-out
independently: the captured coordinates, the GPS accuracy, the computed
distance from the outlet, and the source (own phone or counter tablet) — so a
disputed check-in is reviewable from stored inputs rather than a bare verdict.
Overrides SHALL record who overrode, when, and why.

#### Scenario: A check-in is recorded

- **WHEN** an attendance row is written with check-in location data
- **THEN** the row stores the coordinates, accuracy, computed distance, and source together with the attendance status

### Requirement: One attendance row per employee per business day

The database SHALL enforce at most one attendance row per employee per
business date.

#### Scenario: A duplicate attendance row

- **WHEN** a second attendance row is inserted for the same employee and business date
- **THEN** the database rejects it with a constraint violation

### Requirement: A closed outlet accepts no new check-ins and never blocks a check-out

A check-in recorded against an outlet whose active state is off SHALL be
refused, and the refusal SHALL name the reason so that the person holding the
phone learns the shop is marked closed rather than that something broke.

A check-out SHALL never be refused for this or any other reason. Someone whose
outlet is deactivated mid-shift SHALL still be able to close the day they
started.

#### Scenario: Check-in at a deactivated outlet

- **WHEN** an employee attempts to check in and their outlet is deactivated
- **THEN** the check-in is refused by the database, and the surface explains
  that the outlet is marked closed

#### Scenario: Check-out survives a mid-shift deactivation

- **WHEN** an employee checked in while the outlet was active and the outlet is
  deactivated before they check out
- **THEN** the check-out is recorded normally

#### Scenario: Reactivating restores check-in

- **WHEN** a deactivated outlet is reactivated
- **THEN** check-ins are accepted again with no other intervention

### Requirement: An employee with no linked roster row is told what is missing

An account whose profile is linked to no roster row SHALL be told, on its own
attendance surface, that it is not on the staff list and that an admin must add
them — not shown an empty day, an error, or a check-in control that cannot
work.

#### Scenario: A signed-in Employee who is on no roster

- **WHEN** an Employee with no linked roster row opens their attendance surface
- **THEN** they are told they are not on the staff list yet and that their
  manager can add them, and no check-in control is offered
