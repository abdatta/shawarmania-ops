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

### Requirement: An employee checks in and out from their own phone

An Employee SHALL be able to record a check-in and a later check-out for the
current business day from a single primary action on their home screen, and
SHALL see today's status without navigating away from it. Each event SHALL
capture the device's coordinates and reported accuracy at the moment of the
action, and store them on the attendance row together with the distance to the
outlet and the source.

#### Scenario: An employee checks in inside the fence

- **WHEN** an Employee taps check-in and the device reports a position within the outlet's geofence radius
- **THEN** an attendance row is recorded for the current business day with status present, the check-in time, the coordinates, the accuracy, the computed distance, and source `phone`

#### Scenario: An employee checks out

- **WHEN** an Employee who has already checked in today taps check-out
- **THEN** the same attendance row gains the check-out time, coordinates, accuracy, computed distance, and source, and no second row is created

#### Scenario: The day is already complete

- **WHEN** an Employee who has already checked out today opens their home screen
- **THEN** the screen shows the completed day and offers no further check-in or check-out action

### Requirement: The geofence verdict is computed by the database from the stored evidence

The database SHALL compute the stored check-in and check-out distances from the
submitted coordinates and the outlet's recorded position, disregarding any
distance supplied by the client. A check-in whose computed distance exceeds the
outlet's geofence radius and which carries no override SHALL NOT be recorded
with status present.

#### Scenario: A client submits a distance that contradicts its coordinates

- **WHEN** an attendance row is written with coordinates far from the outlet but a small claimed distance
- **THEN** the stored distance is the one computed from the coordinates, not the claimed one

#### Scenario: An employee attempts to record themselves present from outside the fence

- **WHEN** an Employee writes an attendance row with status present and coordinates beyond the outlet's geofence radius, and no override is recorded
- **THEN** the stored row has status absent

#### Scenario: A manager marks a leave day for someone inside the fence

- **WHEN** a Franchise Admin sets a status other than present on an attendance row whose check-in was inside the fence
- **THEN** the status is stored as written, because the geofence only denies a present claim and never imposes one

#### Scenario: A phone check-in carries no coordinates at all

- **WHEN** a check-in is written from a phone with no coordinates, at an outlet that has a captured position, and no override is recorded
- **THEN** the row is stored with status absent, because a check-in the fence cannot evaluate must not be counted present — otherwise refusing location permission would be the simplest way to defeat the geofence

#### Scenario: The outlet has no captured position

- **WHEN** an Employee checks in at an outlet whose coordinates have not been captured
- **THEN** the check-in is recorded and counted present, the distance is stored as unknown, and both the employee's and the manager's views state that the outlet has no captured position rather than showing a distance

#### Scenario: The counter tablet checks someone in

- **WHEN** an enrolled counter device records a check-in with no coordinates
- **THEN** the row is counted present, because the device stands in the outlet and the fence is not what vouches for it

### Requirement: A blocked check-in explains itself and offers a way through

A check-in refused by the geofence SHALL present the reason, how far outside
the radius the reading was, the accuracy of that reading, and an action to
request a manager override. Refusing SHALL NOT record an attendance row until
the employee asks for an override.

#### Scenario: An employee is outside the fence

- **WHEN** an Employee taps check-in and the device reports a position beyond the outlet's geofence radius
- **THEN** the check-in is refused and the screen states the distance beyond the fence, the reading's accuracy, and offers to request a manager override

#### Scenario: An employee abandons a blocked check-in

- **WHEN** an Employee is shown the blocked state and does not request an override
- **THEN** no attendance row exists for them for that business day

#### Scenario: An employee requests an override

- **WHEN** an Employee requests an override from the blocked state
- **THEN** an attendance row is recorded for the business day carrying the check-in time and full location evidence, with status absent, and the outlet's manager sees it as awaiting an override

#### Scenario: The device cannot supply a position

- **WHEN** location permission is denied, unavailable, or times out
- **THEN** the screen states which of those happened and offers the same override request path, rather than failing with a generic error

### Requirement: An override is a recorded human decision

Only a Franchise Admin of the row's own outlet or a Super Admin SHALL be able
to clear a blocked check-in. Doing so SHALL record who approved it, when, and a
reason that cannot be empty. An Employee SHALL NOT be able to clear their own.

#### Scenario: A manager approves an override

- **WHEN** a Franchise Admin approves a pending override on one of their outlet's rows with a reason
- **THEN** the row records the approver's identity, the approval time, and the reason, and its status becomes present

#### Scenario: A manager approves without a reason

- **WHEN** an override approval is attempted with an empty reason
- **THEN** it is refused and nothing is recorded

#### Scenario: An employee attempts to clear their own block

- **WHEN** an Employee writes override fields onto their own attendance row
- **THEN** the database refuses the write

### Requirement: An employee sees exactly what their manager sees

An Employee's own attendance history SHALL show, for each of their days, the
same facts the outlet's manager sees about that day: times, status, distance,
accuracy, source, and any override with its approver and reason.

#### Scenario: An overridden day in the employee's history

- **WHEN** an Employee views a day that was cleared by a manager override
- **THEN** the entry shows the override, who approved it, and the reason they gave

#### Scenario: A flagged day in the employee's history

- **WHEN** an Employee views a day whose check-out was recorded far from the outlet
- **THEN** the entry shows the same distance and flag the manager's view shows

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

### Requirement: An outlet's position is captured on site, by the owner

The app SHALL provide a Super Admin surface that reads the current device's
position, shows the reading's accuracy before anything is saved, and stores it
as the outlet's coordinates together with the geofence radius. The stored
position SHALL record the accuracy of the fix that produced it and when it was
captured. No other role SHALL be able to write an outlet's position or radius.

#### Scenario: The owner captures a position at the counter

- **WHEN** a Super Admin takes a reading on the outlet screen and saves it
- **THEN** the outlet's coordinates, geofence radius, the accuracy of the saved fix, and the capture time are stored

#### Scenario: The reading is too poor to be a reference point

- **WHEN** the best available reading is less accurate than the permitted threshold for a permanent position
- **THEN** saving is refused, and the screen explains that a loose reference point is judged against every future check-in

#### Scenario: The reading is usable but imprecise

- **WHEN** the best available reading is usable but not tight
- **THEN** saving is permitted and the screen warns, in plain words, what that costs

#### Scenario: A manager attempts to move the fence

- **WHEN** a Franchise Admin attempts to write coordinates or a geofence radius for their outlet
- **THEN** the database refuses the write

### Requirement: Location is captured only at check-in and check-out

The application SHALL read the device's position only in direct response to a
check-in, a check-out, or an outlet position capture. It SHALL NOT observe
position in the background, on a schedule, or while any screen merely sits
open.

#### Scenario: An employee leaves the app open

- **WHEN** the Employee home screen is open and no check-in or check-out is attempted
- **THEN** no position is read and nothing is stored

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
