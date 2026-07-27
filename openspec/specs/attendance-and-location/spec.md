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
