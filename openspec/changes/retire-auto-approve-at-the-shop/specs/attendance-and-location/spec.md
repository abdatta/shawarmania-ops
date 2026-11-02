## MODIFIED Requirements

### Requirement: An employee checks in from their own phone, and a check-in at the shop is approved automatically

An Employee SHALL be able to record a check-in for the current business day
from a single primary action on their home screen, and SHALL see today's
status without navigating away from it. Each check-in attempt SHALL capture the
device's coordinates and reported accuracy at the moment of the action, and
store them together with the database-computed distance, the target outlet,
the target outlet's stamped arrival deadline and the source.

**A check-in at the shop SHALL be approved automatically.** Where the database-computed
distance is at most the target outlet's own geofence radius, the outlet does
not require a manager for every check-in, and the reading lies inside no other
active outlet's fence where the person holds a live staff assignment, the
command that records the attempt SHALL also settle the day as present, in the
same transaction, with no manager. The reading's accuracy SHALL NOT bear on
this. A late arrival SHALL still be tagged late. The screen SHALL say the day
was approved.

Any other recorded attempt (outside the fence, with no position, at an
outlet whose position was never captured, ambiguous between two outlets, or at
an outlet whose managers require approval of every check-in) SHALL count as
nothing until a manager approves it, and the screen SHALL say so plainly rather
than implying the day is done. Where a manager has already denied the day, a
newer pending attempt SHALL leave the outcome absent and SHALL be shown as
awaiting review in addition to that outcome.

The screen SHALL offer no further employee check-in when the newest pending
attempt is inside the fence, when a manager prevented retry, or when the day is
approved, auto-approved at the shop, manually settled, leave or half day. It SHALL
offer retry when the newest pending attempt is outside or unverifiable, or when
the latest denial left retry open, subject to the target outlet still reckoning
the same explicit business date as current. An in-fence retry of a pending
outside attempt SHALL be approved automatically under the same rule.

#### Scenario: An employee checks in inside the fence

- **WHEN** an Employee taps check-in and the database measures the reading within the outlet's geofence radius, at an outlet whose managers do not require approval of every check-in
- **THEN** an attempt is recorded with the check-in time, outlet, coordinates, accuracy, database-computed distance, stamped deadline and source `phone`, the day is present with an `auto_approved` decision and no approver, and the screen states that the day counted

#### Scenario: A rough reading inside the fence still counts

- **WHEN** the reading is 31 m from the outlet at a reported accuracy of ±104 m and the radius is 150 m
- **THEN** the day is auto-approved at the shop, because accuracy does not bear on the rule

#### Scenario: A late check-in at the shop counts and is tagged late

- **WHEN** an Employee checks in inside the fence after the outlet's arrival deadline
- **THEN** the day is present and reads late, with no different status

#### Scenario: An outlet whose managers approve every check-in

- **WHEN** an Employee checks in inside the fence at an outlet whose managers require approval of every check-in
- **THEN** the attempt is recorded and waits for a manager, and no further check-in is offered

#### Scenario: A first check-in is not silently undone

- **WHEN** an Employee's first check-in of a business day is auto-approved at the shop
- **THEN** the stored day reads present after the command commits, as it does for a retry that counts

#### Scenario: A reading inside two outlets' fences waits

- **WHEN** a person staffed at two active outlets checks in at a reading inside both fences
- **THEN** the attempt is recorded at the named outlet and waits for a manager

#### Scenario: A weak pending attempt can be retried

- **WHEN** an Employee's newest pending attempt is outside the fence or has unverifiable location
- **THEN** the screen offers another check-in while preserving the existing attempt, and a retry inside the fence is approved automatically

#### Scenario: A denied day stays absent during retry review

- **WHEN** an Employee records a permitted new attempt outside the fence after a manager denied the day
- **THEN** the day remains absent and also reads as awaiting review until a manager approves the new attempt

#### Scenario: An auto-approved or approved day cannot be reopened by the employee

- **WHEN** an Employee whose day is auto-approved at the shop or approved opens their home screen
- **THEN** the outcome is shown and no re-check action is offered

#### Scenario: A multi-outlet retry does not create a second outcome

- **WHEN** a person assigned to two outlets retries at the other assigned outlet for the same business date
- **THEN** the new attempt may become the one awaiting review or the one that counts, but the person still has exactly one attendance outcome for that date

### Requirement: Each outlet's managers set its attendance rules

Each outlet SHALL carry two attendance settings, both off by default:
**Manager approves every check-in**, which with it on makes every check-in at
that outlet wait for a manager, and **Block check-ins away from the shop**,
which with it on refuses any check-in outside the fence or with no position.

The owner, for any outlet, and a Franchise Admin with a live assignment at the
outlet, SHALL be able to change both, through one command that writes those two
settings and nothing else, with authority resolved from the session. An
Employee, a Biller and a counter device SHALL NOT. The outlet's position and
geofence radius SHALL remain changeable by the owner alone.

The settings SHALL appear on the outlet's own page, in an Attendance section,
to the owner and that outlet's managers.

#### Scenario: A manager requires approval of every check-in

- **WHEN** a Franchise Admin turns on Manager approves every check-in for their outlet
- **THEN** the next in-fence check-in there waits for a manager

#### Scenario: A manager cannot change another outlet's rules

- **WHEN** a Franchise Admin sends a hand-crafted request changing the attendance settings of an outlet they hold no live assignment at
- **THEN** the database refuses it

#### Scenario: Staff cannot change the rules

- **WHEN** an Employee, a Biller or a counter device sends a hand-crafted request changing an outlet's attendance settings
- **THEN** the database refuses it

#### Scenario: A manager cannot move the fence

- **WHEN** a Franchise Admin sends any request changing their outlet's position or geofence radius
- **THEN** the database refuses it

### Requirement: A day auto-approved at the shop reads as auto-approved, on every surface

A day whose latest decision is `auto_approved` SHALL read **Present** with
*Auto-approved at the shop* and its time, and no approver, on the manager's roll-call,
the person view and the person's own history. It SHALL NOT be counted as waiting
or carry an attention badge. A manager SHALL be able to correct it as any
settled day, with a reason.

#### Scenario: The manager reads an auto-approved day

- **WHEN** a Franchise Admin opens a day on which a person's check-in auto-approved at the shop
- **THEN** that person reads Present, Auto-approved at the shop, with the time, and is not among the waiting arrivals

#### Scenario: A manager corrects an auto-approved day

- **WHEN** a Franchise Admin corrects an auto-approved day to absent with a reason
- **THEN** the correction is appended, the day is absent, and the person reads the reason

### Requirement: The person's own screens speak in plain words

The person's Home and My attendance SHALL:
- name the outlet and the date with its weekday;
- show the arrival deadline before the check-in;
- describe their evidence as *At the shop*, *a distance away*, or *No
  location*, with metres and accuracy behind a disclosure.

They SHALL carry no sentence under a heading. A waiting day SHALL be shown with
a neutral mark, not a warning. Retrying a waiting check-in SHALL be a secondary
action, never the primary one. Rechecking a check-in waiting from away SHALL
record nothing while the new reading is still outside the fence or has no
position, and SHALL say so briefly in place of the recheck action, not as a
question, before the action returns. A retry that is recorded
SHALL be sent without asking the employee to confirm what it changes, late
included: a later check-in from the shop is the truer one. Where the first reading is outside the fence or
reports worse than ±50 m, the phone MAY keep reading for up to six seconds, in
direct response to the same check-in, and use the best reading.

#### Scenario: A check-in at the shop shows a success moment

- **WHEN** a check-in is auto-approved at the shop
- **THEN** Home shows a tick, the time, the outlet's name and that the day was approved, with no warning mark

#### Scenario: The deadline has passed and nobody checked in

- **WHEN** an Employee with no check-in opens Home after the outlet's deadline
- **THEN** Home says they have not checked in and are late since the deadline, and still offers check-in

### Requirement: A month of attendance reads as a calendar

My attendance and the manager's By staff SHALL show
one month as a calendar of days. Each day's state SHALL be drawn by shape as
well as colour (a ring, a ring with a clock, a ring with a slash, a dashed ring, a
bare number), each ring in the colour of the day's status chip, never by colour alone, and SHALL be named to a screen reader. Opening a day SHALL show its detail
with the shared evidence components. Both surfaces SHALL render the same
component. The month's counts SHALL keep their numbers, each beside the mark it counts
so that the counts are the key.

#### Scenario: A person reads their month

- **WHEN** an Employee opens My attendance
- **THEN** the month is a calendar of day numbers, each day's state drawn by shape as well as colour and named to a screen reader, and the counts for present, late, absent and waiting sit above it beside their marks

#### Scenario: The manager reads the same month

- **WHEN** a Franchise Admin opens By staff for that person and month
- **THEN** the same calendar and the same counts are shown
