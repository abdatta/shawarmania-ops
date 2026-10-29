## RENAMED Requirements

- FROM: `### Requirement: An employee checks in from their own phone, and the day waits for a manager`
- TO: `### Requirement: An employee checks in from their own phone, and a check-in at the shop is approved automatically`

- FROM: `### Requirement: Only a recorded approval settles a day`
- TO: `### Requirement: A recorded approval, or a check-in at the shop, settles a day`

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

#### Scenario: With the gate off every check-in waits

- **WHEN** `auto-approve-at-the-shop` is off and an Employee checks in inside the fence, whichever build the phone runs
- **THEN** the attempt is recorded and waits for a manager, exactly as before this change

### Requirement: A blocked check-in explains itself and offers a way through

A check-in taken beyond the outlet's geofence radius SHALL present the reason in
one sentence and one primary decision, with the distance and the reading's
accuracy behind a **Why?** disclosure.

Where the outlet does not block check-ins away from the shop, it SHALL say the
person does not seem to be at the shop and offer **Check in anyway**, with a
small line saying their manager will need to approve it. Its buttons SHALL be
about checking in, never about the manager. Showing that state SHALL NOT record
an attendance row until the employee confirms the check-in.

Where the outlet blocks check-ins away from the shop, it SHALL say the check-in
was not recorded, and SHALL say that the person may try again from the shop or
ask their manager to record it. It SHALL offer no way to record it.

A location permission the device has denied SHALL be explained as a setting to
change, with how to change it, and SHALL NOT be answered by an action to try
again alone.

#### Scenario: An employee is outside the fence

- **WHEN** an Employee taps check-in and the device reports a position beyond the outlet's geofence radius at an outlet that does not block away check-ins
- **THEN** the check-in is not yet recorded, the screen says they do not seem to be at the shop, offers Check in anyway with a small line that their manager will need to approve it, and shows the distance and the reading's accuracy under Why?

#### Scenario: An employee abandons a blocked check-in

- **WHEN** an Employee is shown the outside state and does not choose to record it
- **THEN** no attendance row exists for them for that business day

#### Scenario: An employee records it anyway

- **WHEN** an Employee chooses to record a check-in from the outside state
- **THEN** an attendance row is recorded for the business day carrying the check-in time and full location evidence, with status absent, and the outlet's manager sees it as waiting for approval

#### Scenario: An outlet that blocks away check-ins

- **WHEN** an Employee taps check-in beyond the fence at an outlet that blocks away check-ins
- **THEN** the screen says the check-in was not recorded and what to do instead, and offers no way to record it

#### Scenario: The device cannot supply a position

- **WHEN** location permission is denied, unavailable, or times out
- **THEN** the screen states which of those happened; for a denial it explains how to turn location back on; and it offers the record-it-anyway path only where the outlet does not block away check-ins

### Requirement: A recorded approval, or a check-in at the shop, settles a day

A day carrying a check-in SHALL be counted present only when an approval is
recorded against it, or when the check-in command auto-approved it at the shop. Only
a Super Admin, or a Franchise Admin holding a live assignment at the row's own
outlet, SHALL be able to record an approval, and the database SHALL resolve
that authority from the approving session rather than from anything the
request states. An Employee SHALL NOT be able to approve their own day, or
anyone else's. A `auto_approved` decision SHALL be written by the check-in
command alone, SHALL name no actor, and SHALL stamp the radius that judged it.
No client role SHALL be able to write one.

An approval SHALL require a check-in on the row: a day nobody claimed is not
a day anybody can settle.

An approval SHALL be a deliberate act about a named person. One action MAY
settle several waiting days, but only where every one of them was added to the
set by an action of its own, so that approving remains deliberate per person
rather than a rubber stamp. No surface SHALL offer a control that adds more than
one person to a set at once.

The approving device's position SHALL be read in direct response to the action
that records the approvals, and SHALL NOT be carried over to a later action. A
reading that could not be taken SHALL NOT be substituted by an earlier one.

#### Scenario: A manager approves a waiting day

- **WHEN** a Franchise Admin approves a waiting check-in at their own outlet
- **THEN** the row records the approver's identity, the approval time and the
  approver's position, and its status becomes present

#### Scenario: A day auto-approved at the shop names no approver

- **WHEN** a check-in is auto-approved at the shop
- **THEN** the day is present, its approver fields are empty, and its latest
  decision is `auto_approved` with no actor and the outlet's radius at that moment

#### Scenario: An employee attempts to approve their own day

- **WHEN** an Employee writes approval fields onto their own attendance row
- **THEN** the database refuses the write

#### Scenario: A client writes an `auto_approved` decision by hand

- **WHEN** any authenticated session inserts an `auto_approved` decision directly
- **THEN** the database refuses the write

#### Scenario: A manager at another outlet is refused

- **WHEN** a Franchise Admin attempts to approve a row belonging to an outlet
  they hold no live assignment at
- **THEN** the database refuses the write

#### Scenario: An approval with no check-in is refused

- **WHEN** an approval is written onto a row that carries no check-in
- **THEN** the database refuses the write

#### Scenario: A whole morning cannot be approved without being selected

- **WHEN** a Franchise Admin opens a day on which several arrivals are waiting
- **THEN** the count of waiting days is stated, no control adds more than one of
  them to a set, and each is added by an action of its own before any approval

#### Scenario: A position is read for the action, not kept

- **WHEN** a manager approves, waits, and approves again
- **THEN** the second action reads the position again rather than reusing the
  first reading, however little time has passed

## ADDED Requirements

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
to the owner and that outlet's managers, and SHALL take effect only while
`auto-approve-at-the-shop` is on.

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

#### Scenario: The settings do nothing with the gate off

- **WHEN** `auto-approve-at-the-shop` is off and an outlet blocks away check-ins
- **THEN** a check-in outside the fence is recorded and waits for a manager, as before this change

### Requirement: A check-in away from the shop can be refused

Where an outlet blocks check-ins away from the shop, the check-in command SHALL
refuse an attempt whose database-computed distance exceeds the outlet's radius
or cannot be computed (no position, or an outlet whose position was never
captured), and SHALL write nothing. The refusal SHALL be the database's, not
only the screen's. **Record arrival** by a manager SHALL remain available and
SHALL settle such a day as it does today.

#### Scenario: A hand-crafted check-in from away is refused

- **WHEN** an Employee at an outlet that blocks away check-ins sends a check-in request whose coordinates are 2.6 km from the outlet
- **THEN** the database refuses it and no attendance row, attempt or decision exists for it

#### Scenario: No position is refused under Block

- **WHEN** an Employee at an outlet that blocks away check-ins checks in with no position
- **THEN** the check-in is refused and nothing is recorded

#### Scenario: The manager records the day instead

- **WHEN** a refused person asks their manager, who records their arrival
- **THEN** the day is present with the manager as its enterer, as for any manual entry

#### Scenario: A day already waiting is untouched by Block

- **WHEN** an outlet turns on Block while an away check-in is waiting
- **THEN** that day still waits for a manager

### Requirement: A day auto-approved at the shop reads as auto-approved, on every surface

A day whose latest decision is `auto_approved` SHALL read **Present** with
*Auto-approved at the shop* and its time, and no approver, on the manager's roll-call,
the person view and the person's own history. It SHALL NOT be counted as waiting
or carry an attention badge. A manager SHALL be able to correct it as any
settled day, with a reason. This SHALL hold with `auto-approve-at-the-shop` off, for
days auto-approved while it was on.

#### Scenario: The manager reads an auto-approved day

- **WHEN** a Franchise Admin opens a day on which a person's check-in auto-approved at the shop
- **THEN** that person reads Present, Auto-approved at the shop, with the time, and is not among the waiting arrivals

#### Scenario: A manager corrects an auto-approved day

- **WHEN** a Franchise Admin corrects an auto-approved day to absent with a reason
- **THEN** the correction is appended, the day is absent, and the person reads the reason

#### Scenario: The gate is turned off after days were auto-approved

- **WHEN** `auto-approve-at-the-shop` is turned off
- **THEN** days already auto-approved at the shop still read present and auto-approved, and remain correctable

### Requirement: The person's own screens speak in plain words

While `refreshed-staff-screens` is on, the person's Home and My attendance SHALL:
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

While `refreshed-staff-screens` is on, My attendance and the manager's By staff SHALL show
one month as a calendar of days. Each day's state SHALL be drawn by shape as
well as colour (a solid disc, a disc with a clock, a pale disc, a dashed ring, a
bare number), never by colour alone, and SHALL be named to a screen reader. Opening a day SHALL show its detail
with the shared evidence components. Both surfaces SHALL render the same
component. The month's counts SHALL keep their numbers, each beside the mark it counts
so that the counts are the key.

#### Scenario: A person reads their month

- **WHEN** an Employee opens My attendance
- **THEN** the month is a calendar of day numbers, each day's state drawn by shape as well as colour and named to a screen reader, and the counts for present, late, absent and waiting sit above it beside their marks

#### Scenario: The manager reads the same month

- **WHEN** a Franchise Admin opens By staff for that person and month
- **THEN** the same calendar and the same counts are shown
