# attendance-and-location — delta for multi-outlet-people

## ADDED Requirements

### Requirement: The geofence decides which outlet a person is checking in at

A person holding live assignments at more than one outlet SHALL check in and
out from the same single action as everybody else. The outlet SHALL be resolved
from where they are standing, never chosen by them:

- Holding one assignment, that outlet is used — unchanged from single-outlet
  behaviour.
- Holding several, the outlet whose geofence contains the reading is used; if
  several contain it, the nearest.
- Standing inside no assigned outlet's fence, the nearest assigned outlet is
  used, and the check-in is blocked exactly as it is today, awaiting the
  manager override that already exists.

No outlet picker, role switcher, or session-scoped mode SHALL be offered
anywhere in this flow.

Where no position can be obtained at all and the person holds more than one
assignment, the check-in SHALL be refused with an explanation, because nothing
can honestly resolve the outlet; the person SHALL be directed to the manual
entry an admin can record. With a single assignment this case SHALL behave
exactly as it does today.

#### Scenario: A person assigned to two outlets checks in at one of them

- **WHEN** a person assigned to both outlets taps check-in while standing
  inside one outlet's geofence
- **THEN** the attendance row is recorded at that outlet with status present,
  and nothing asked them which outlet they were at

#### Scenario: The same person checks in at the other outlet later

- **WHEN** the same person taps check-in on another day while standing inside
  the other outlet's geofence
- **THEN** the row is recorded at that other outlet, from the same phone and
  the same single action

#### Scenario: Standing at neither assigned outlet blocks, as today

- **WHEN** a person assigned to two outlets taps check-in from outside both
  geofences
- **THEN** the row is recorded at the nearer assigned outlet with status
  absent, and the manager of that outlet can clear it with a recorded override

#### Scenario: No position and several assignments refuses rather than guesses

- **WHEN** a person assigned to two outlets taps check-in and the device can
  supply no position at all
- **THEN** the check-in is refused with an explanation that their outlet cannot
  be determined, and they are told an admin can record it for them

### Requirement: A person's own attendance spans every outlet they work at

The person's own attendance history SHALL list the days they worked at every
outlet they hold or held an assignment at, each entry naming its outlet. A
person who has only ever worked at one outlet SHALL see what they see today.

#### Scenario: A split day shows both outlets

- **WHEN** a person checks in at one outlet in the morning and at the other in
  the evening of the same business day, and opens their own attendance
- **THEN** both days' rows are listed, each naming the outlet it was worked at

#### Scenario: A single-outlet person sees no new chrome

- **WHEN** a person who holds one assignment opens their own attendance
- **THEN** the view is as it was, with the outlet named but nothing to choose

## RENAMED Requirements

- FROM: `### Requirement: One attendance row per employee per business day`
- TO: `### Requirement: One attendance row per person per outlet per business day`

## MODIFIED Requirements

### Requirement: One attendance row per person per outlet per business day

The database SHALL enforce at most one attendance row per person per outlet per
business date. A person may therefore hold two rows for one business date when
they worked a morning at one outlet and an evening at another, and may not hold
two rows for the same outlet on the same date.

#### Scenario: A duplicate attendance row at the same outlet

- **WHEN** a second attendance row is inserted for the same person, outlet and
  business date
- **THEN** the database rejects it with a constraint violation

#### Scenario: A split day across two outlets is permitted

- **WHEN** a person assigned to both outlets has a row at one outlet for a
  business date and a row is inserted at the other outlet for the same date
- **THEN** the database accepts it

### Requirement: Attendance belongs to the person's account

An attendance row SHALL reference the person's account record directly, with
one row per person per outlet per business day. Rows SHALL survive the ending
of the assignment they were worked under, the person's departure and the
account's deactivation — the days were worked — and recorded attendance SHALL
block deletion of the account it belongs to.

#### Scenario: Departure does not touch the record

- **WHEN** a person with recorded attendance has an assignment ended or their
  account deactivated
- **THEN** every attendance row remains, attributed to the same person at the
  same outlet

#### Scenario: One row per person per outlet per day

- **WHEN** a second check-in is recorded for a person at an outlet on a
  business day that already holds their row for that outlet
- **THEN** the existing row is updated; no second row is created

### Requirement: A manager maintains the outlet's staff list

A Franchise Admin SHALL see, on their outlet's attendance and people surfaces,
every person holding a live assignment at that outlet — and only those people.
A person assigned to two outlets SHALL appear on both outlets' lists, and each
manager SHALL see only the attendance rows worked at their own outlet.

#### Scenario: A multi-outlet person appears on both lists

- **WHEN** a person holds live assignments at both outlets and each manager
  opens their own outlet's attendance day
- **THEN** the person appears on both, and each manager sees only the rows
  worked at their own outlet

#### Scenario: Ending an assignment removes them from that list only

- **WHEN** a person's assignment at one outlet is ended
- **THEN** they leave that outlet's staff list and its new attendance days, and
  remain on the other outlet's
