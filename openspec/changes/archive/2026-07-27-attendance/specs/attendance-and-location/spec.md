## ADDED Requirements

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
chosen business day, showing for each employee the check-in and check-out
times, the distance and accuracy of each reading, the source, and any flags,
and SHALL be able to act on pending overrides from that view.

#### Scenario: A manager opens the day

- **WHEN** a Franchise Admin opens attendance for a business day
- **THEN** every roster employee's record for that day is listed with times, evidence, and flags, and rows awaiting an override are distinguished

#### Scenario: A manager opens a day at another outlet

- **WHEN** a Franchise Admin requests attendance rows belonging to an outlet other than their own
- **THEN** no rows are returned

### Requirement: A manager maintains the employee roster

A Franchise Admin SHALL be able to list, add, and edit their own outlet's
employee roster, including employment status, and a Super Admin SHALL be able
to do so for any outlet. Roster records SHALL remain distinct from app
accounts: an employee may exist without a login.

#### Scenario: A manager adds an employee

- **WHEN** a Franchise Admin adds an employee to their outlet with a code and name
- **THEN** the roster row is created for their own outlet, with no app account implied or required

#### Scenario: A manager ends someone's employment

- **WHEN** a Franchise Admin sets an employee's employment status to inactive or terminated
- **THEN** the roster reflects it and that employee is no longer offered for new attendance

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
