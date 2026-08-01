## MODIFIED Requirements

### Requirement: One attendance row per person per outlet per business day

The database SHALL enforce at most one attendance row per person per business
date, across every outlet. A person assigned to more than one outlet works at one
of them on any given day, so a day belongs to the person rather than to the shop,
and a second row for the same person on the same date SHALL be refused whatever
outlet it names.

Recording a genuine split day across two outlets is therefore not possible. This
is deliberate and is recorded as a limitation, not a defect.

#### Scenario: A duplicate attendance row at the same outlet

- **WHEN** a second attendance row is inserted for the same person, outlet and
  business date
- **THEN** the database rejects it with a constraint violation

#### Scenario: A second row at a different outlet on the same date

- **WHEN** a person assigned to both outlets holds a row at one outlet for a
  business date and a row is inserted at the other outlet for the same date
- **THEN** the database rejects it with a constraint violation

#### Scenario: The same person on different dates at different outlets

- **WHEN** a person assigned to both outlets holds a row at one outlet on one
  business date and a row is inserted at the other outlet on a different date
- **THEN** the database accepts it

### Requirement: Attendance belongs to the person's account

An attendance row SHALL reference the person's account record directly, with
one row per person per business day. Rows SHALL survive the ending of the
assignment they were worked under, the person's departure and the account's
deactivation, because the days were worked, and recorded attendance SHALL block
deletion of the account it belongs to.

#### Scenario: Departure does not touch the record

- **WHEN** a person with recorded attendance has an assignment ended or their
  account deactivated
- **THEN** every attendance row remains, attributed to the same person at the
  same outlet

#### Scenario: One row per person per day

- **WHEN** a second check-in is recorded for a person on a business day that
  already holds their row
- **THEN** the existing row is updated; no second row is created

### Requirement: An employee checks in from their own phone, and the day waits for a manager

An Employee SHALL be able to record a check-in for the current business day
from a single primary action on their home screen, and SHALL see today's
status without navigating away from it. The check-in SHALL capture the
device's coordinates and reported accuracy at the moment of the action, and
store them on the attendance row together with the distance to the outlet and
the source.

A recorded check-in SHALL count as nothing until a manager approves it, and
the screen SHALL say so plainly rather than implying the day is done.

Once a day is recorded, the screen SHALL offer no further check-in for that day
at any outlet. A person assigned to several outlets has one day like everybody
else, and an action offering to start another one would invite a row the database
refuses.

#### Scenario: An employee checks in inside the fence

- **WHEN** an Employee taps check-in and the device reports a position within the outlet's geofence radius
- **THEN** an attendance row is recorded for the current business day with the check-in time, the coordinates, the accuracy, the computed distance and source `phone`, and the screen states that it is waiting for their manager

#### Scenario: The day is already recorded

- **WHEN** an Employee who has already checked in today opens their home screen
- **THEN** the screen shows the recorded arrival and its waiting or approved
  state, and offers no second check-in

#### Scenario: A multi-outlet person is offered no second outlet

- **WHEN** a person assigned to two outlets has a recorded arrival today and
  opens their home screen
- **THEN** no action is offered to check in at another outlet

### Requirement: No check-in by the deadline reads absent

A person holding a live assignment SHALL read as absent on every surface, the
manager's day, the person view, the employee's own history, and every count
derived from them, once the arrival deadline for a business day has passed with
no attendance row recorded for them **anywhere** that day. Before that deadline
has passed, the same person SHALL read as not yet arrived.

Absence SHALL be judged once per person per business date, never once per outlet.
A person carrying a row at one outlet SHALL NOT read as absent at another on the
same date, on any surface or in any count.

A stored row SHALL always take precedence: a day recorded as leave, half day
or anything else stays what it was recorded as.

This state SHALL be derived from the stored rows and the outlet's clock. No
scheduled process SHALL manufacture attendance rows.

A day SHALL only be read this way inside the person's assignment window, so days
before they joined or after they left are not counted at all.

#### Scenario: Nobody checked in, and the deadline passed

- **WHEN** a manager opens a business day whose arrival deadline has passed and
  a staff member has no attendance row at any outlet
- **THEN** that person reads as absent for the day

#### Scenario: A day worked at another outlet is not absent

- **WHEN** a person assigned to two outlets holds a recorded arrival at one of
  them, and the other outlet's deadline for that date passes
- **THEN** that person does not read as absent, and the day is counted once

#### Scenario: The deadline has not passed yet

- **WHEN** a manager opens today before the outlet's arrival deadline and a
  staff member has no attendance row
- **THEN** that person reads as not yet arrived rather than absent

#### Scenario: A late check-in after reading absent

- **WHEN** a person with no row on a day past its deadline then checks in
- **THEN** the row is recorded as a late arrival waiting for approval, and the
  day stops reading absent

#### Scenario: A recorded leave day is not overwritten

- **WHEN** a manager has marked a day as leave and its arrival deadline passes
- **THEN** the day still reads as leave

#### Scenario: No row is invented

- **WHEN** any number of business days pass with nobody checking in
- **THEN** no attendance row exists for those days, and the absent reading is
  derived when the day is read

#### Scenario: Days outside the assignment are not counted

- **WHEN** a person's days are read over a range extending before they were
  assigned or after their assignment ended
- **THEN** those days are not shown or counted as absent

### Requirement: The geofence decides which outlet a person is checking in at

A person holding live assignments at more than one outlet SHALL check in from
the same single action as everybody else. Wherever a position reading exists, the
outlet SHALL be resolved from where they are standing and SHALL NOT be chosen by
them:

- Holding one assignment, that outlet is used, unchanged from single-outlet
  behaviour.
- Holding several, the outlet whose geofence contains the reading is used; if
  several contain it, the nearest.
- Standing inside no assigned outlet's fence, the nearest assigned outlet is
  used, and the check-in is handled exactly as any other out-of-fence reading,
  waiting for that outlet's manager.

No outlet picker, role switcher, or session-scoped mode SHALL be offered in any
of those cases: where a reading exists, the fence is the only chooser.

Where no position can be obtained at all and the person holds more than one
assignment, the person SHALL be asked which outlet they are at, because nothing
else can resolve it and there is no reading for the fence to judge. The resulting
row SHALL be recorded at the chosen outlet with no coordinates, and SHALL wait for
that outlet's manager on the same terms as any other unlocated check-in, which
requires a reasoned approval. With a single assignment this case SHALL behave
exactly as it does today, with no question asked.

#### Scenario: A person assigned to two outlets checks in at one of them

- **WHEN** a person assigned to both outlets taps check-in while standing
  inside one outlet's geofence
- **THEN** the attendance row is recorded at that outlet, waiting for that
  outlet's manager, and nothing asked them which outlet they were at

#### Scenario: The same person checks in at the other outlet later

- **WHEN** the same person taps check-in on another day while standing inside
  the other outlet's geofence
- **THEN** the row is recorded at that other outlet, from the same phone and
  the same single action

#### Scenario: Standing at neither assigned outlet waits, as today

- **WHEN** a person assigned to two outlets taps check-in from outside both
  geofences
- **THEN** the row is recorded at the nearer assigned outlet with status
  absent, no outlet is offered for them to choose, and the manager of that
  outlet can settle it with a reasoned approval

#### Scenario: No position and several assignments asks which outlet

- **WHEN** a person assigned to two outlets taps check-in and the device can
  supply no position at all
- **THEN** the screen states that their position could not be read and asks
  which outlet they are at, and no row is recorded until they choose

#### Scenario: The chosen outlet is recorded and still waits for a manager

- **WHEN** that person chooses an outlet
- **THEN** the row is recorded at that outlet with no coordinates and status
  absent, and its manager must give a reason to approve it

#### Scenario: A single assignment is never asked

- **WHEN** a person holding one assignment taps check-in and the device can
  supply no position at all
- **THEN** no outlet question is shown, and the flow is unchanged

### Requirement: Only a recorded approval settles a day

A day carrying a check-in SHALL be counted present only when an approval is
recorded against it. Only a Super Admin, or a Franchise Admin holding a live
assignment at the row's own outlet, SHALL be able to record one, and the
database SHALL resolve that authority from the approving session rather than
from anything the request states. An Employee SHALL NOT be able to approve
their own day, or anyone else's.

An approval SHALL require a check-in on the row: a day nobody claimed is not
a day anybody can settle.

An approval SHALL be given one day at a time. No surface SHALL offer an action
that settles more than one waiting day at once, so that approving is a
deliberate act per person rather than a rubber stamp.

The approving device's position reading MAY be reused across approvals given in
quick succession, for no longer than 60 seconds, so that approving one at a
time does not mean one location read per person. A reading that could not be
taken SHALL NOT be reused. A reading SHALL NOT be reused across rows belonging
to different outlets, because one reading cannot vouch for standing in two
places; each outlet's rows SHALL be judged against a reading of their own.

#### Scenario: A manager approves a waiting day

- **WHEN** a Franchise Admin approves a waiting check-in at their own outlet
- **THEN** the row records the approver's identity, the approval time and the
  approver's position, and its status becomes present

#### Scenario: An employee attempts to approve their own day

- **WHEN** an Employee writes approval fields onto their own attendance row
- **THEN** the database refuses the write

#### Scenario: A manager at another outlet is refused

- **WHEN** a Franchise Admin attempts to approve a row belonging to an outlet
  they hold no live assignment at
- **THEN** the database refuses the write

#### Scenario: An approval with no check-in is refused

- **WHEN** an approval is written onto a row that carries no check-in
- **THEN** the database refuses the write

#### Scenario: There is no way to approve a whole morning at once

- **WHEN** a Franchise Admin opens a day on which several arrivals are waiting
- **THEN** the count of waiting days is stated, no control settles more than one
  of them, and each is approved on its own

#### Scenario: A run of approvals reads the position once

- **WHEN** a manager approves several waiting days at the same outlet one after
  another, within a minute of the first
- **THEN** the position is read once and reused, and each row still records its
  own approver, time, position and computed distance

#### Scenario: A reading is not reused across outlets

- **WHEN** a manager viewing two outlets at once approves a row at one outlet
  and then a row at the other within the same minute
- **THEN** the second approval does not reuse the first reading, and the second
  row is judged against its own outlet's fence

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view attendance for a chosen business day
across one or more of the outlets they hold a live assignment at, showing for
each person listed the check-in time, the distance and accuracy of the reading,
the source, whether it was late, whether it is waiting for approval, and any
flags, and SHALL be able to approve waiting days and record manual entries from
that view. A Super Admin SHALL be able to view any outlets on the same terms,
whether or not they hold an assignment there.

Where more than one outlet is in scope, each listed row SHALL name the outlet it
belongs to, and a person appearing at one of the selected outlets SHALL be listed
once rather than once per outlet.

**Who is listed is a question about staff.** The view SHALL list every person
holding a live **staff** assignment at an outlet in scope, and SHALL NOT list a
person merely because they hold a manager or counter assignment there: attendance
is recorded for the people whose arrival the outlet tracks, and a manager or an
owner is not one of them. A person holding a staff assignment alongside any other
SHALL be listed, because their attendance is a real thing.

The view SHALL additionally list any person carrying a recorded row on the day
shown at an outlet in scope, whatever assignment they hold, so that every
recorded day is visible and every count computed from rows can be settled. A
person whose account is deactivated but who has not left SHALL still be listed,
because cutting access does not falsify the day.

The count of days waiting for approval SHALL be stated on the view as a badge
against the business day it belongs to, so a manager learns of them without
reading every row.

The view SHALL also state whether **the outlets in scope** hold unapproved
arrivals on business days other than the one on screen, as a mark on the control
that moves to earlier days and on the control that moves to later ones. That
mark SHALL reflect only the outlets in scope: an outlet outside the selection
SHALL NOT mark these controls.

Days waiting for approval SHALL be listed first, since they are the only rows
on this view carrying somebody else's request for attention. The order SHALL be
fixed while the view is open and recomputed when it is opened again or the
chosen day or selection changes, so that settling a day never moves the rows
beneath it.

#### Scenario: A manager opens the day

- **WHEN** a Franchise Admin opens attendance for a business day
- **THEN** every person holding a staff assignment at that outlet has their
  record for that day listed with the time, evidence, late tag and flags; rows
  waiting for approval are distinguished, counted, and listed above the rest;
  and manually entered events show who entered them

#### Scenario: Two outlets are read together

- **WHEN** a reader who may see two outlets selects both and opens a business day
- **THEN** one list is shown covering both, each row naming its outlet, and a
  person who attended one of them appears once

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

- **WHEN** an outlet in scope has unapproved arrivals on a business day before
  the one on screen
- **THEN** the control that moves to earlier days is marked

#### Scenario: An unselected outlet's backlog does not mark the day controls

- **WHEN** the outlets in scope have no unapproved arrivals on any other day, and
  an outlet outside the selection does
- **THEN** neither day control is marked

#### Scenario: The day on screen is the only one waiting

- **WHEN** the outlets in scope have unapproved arrivals on the day on screen and
  on no other day
- **THEN** the day carries its count and neither day control is marked

### Requirement: Attendance is readable by person over a range, not only by day

Attendance SHALL be readable along two axes: **by outlet**, which is the day
roll-call above, and **by staff**, which is one person over a range of business
dates defaulting to the current month, with a summary of how many days were
present, late, absent and waiting for approval. Choosing the axis SHALL come
before choosing an outlet, and the outlet choice SHALL belong to the by-outlet
axis alone.

The by-staff read SHALL span every outlet the reader may see, and the set of
those outlets SHALL be resolved in the database from the reader's own live
assignments rather than from anything the request names. A Franchise Admin
holding one assignment therefore reads that outlet, a Franchise Admin holding
several reads exactly those, and a Super Admin reads all of them. A reader SHALL
NOT be able to obtain a person's days at an outlet they hold no live assignment
at, by the surface or by a hand-crafted request.

A person's days SHALL be counted once per business date in that summary, whatever
outlet each was worked at, because the summary exists to count days somebody
worked so their pay can be computed by hand.

A person who holds no staff assignment at any outlet the reader may see SHALL NOT
be offered here even if they carry recorded rows there. Such rows are read on the
business day they belong to, which is where anybody settling one needs them; a
range of days for somebody whose days are not tracked would be a pattern of
nothing.

A person reading their own attendance SHALL be offered the same range control,
and their own history SHALL continue to span every outlet they work or worked
at, each day naming its outlet.

#### Scenario: A manager reads one person's month

- **WHEN** a Franchise Admin selects a staff member and the current month
- **THEN** every business day in the range within that person's assignment is
  listed with its status, arrival time, late tag and approval, and the summary
  counts present, late, absent and waiting days

#### Scenario: The owner reads a month across outlets

- **WHEN** a Super Admin selects a person who worked at two outlets during the
  month and reads their range
- **THEN** every day is listed once, each naming the outlet it was worked at,
  and no day is counted twice or shown as absent because it was worked elsewhere

#### Scenario: A multi-outlet manager reads their own outlets and no others

- **WHEN** a Franchise Admin holding live assignments at two outlets reads a
  person's range, and that person also worked at a third outlet
- **THEN** the days at the two outlets are listed and the third outlet's days
  are not returned

#### Scenario: The two views agree

- **WHEN** the same business day is read through the day view and through the
  staff view
- **THEN** both show the same status, time, evidence, late tag and approval

#### Scenario: A manager cannot read another outlet's days for the same person

- **WHEN** a Franchise Admin hand-crafts a request for a person's days naming an
  outlet they hold no live assignment at
- **THEN** no rows are returned for that outlet

#### Scenario: An employee reads their own month across outlets

- **WHEN** a person who works at two outlets reads their own attendance over a
  range
- **THEN** every day is listed, each naming the outlet it was worked at

### Requirement: An admin records attendance on someone's behalf

A Franchise Admin SHALL be able to record a check-in for a person at their own
outlet, and a Super Admin for a person at any outlet, at a past or current
time on the outlet's current business day, never a future time. This is the
escape hatch that keeps a hard arrival rule humane: the phone died, the person
forgot, the network was down.

Where more than one outlet is in scope and the person holds a staff assignment
at more than one of them, the entry SHALL ask which outlet it is being recorded
against. Where the outlet is unambiguous, nothing SHALL be asked.

A manual entry SHALL be stamped by the database with who entered it, the
enterer's id and a snapshot of their name, never client-supplied, and with a
source that names it manual. It SHALL carry no coordinates, because the admin
was not standing where the person was and fabricated evidence is worse than
none; the geofence SHALL NOT judge a manual event. The enterer stamp is the
accountability in evidence's place, and it is also the approval: a day an
admin recorded is settled by the act of recording it.

An Employee or counter-device session SHALL be refused a manual entry by the
database, not only by the absence of a control.

#### Scenario: A past-time check-in for someone else

- **WHEN** a Franchise Admin records a check-in for a person at their outlet
  with this morning's time
- **THEN** the row holds that time, source manual, and the admin's identity
  and name as enterer, stamped by the database, and the day is settled without
  a separate approval

#### Scenario: The outlet is asked for when it is ambiguous

- **WHEN** an admin records an arrival for a person holding staff assignments at
  two outlets, both of which are in scope
- **THEN** the entry asks which outlet the arrival is being recorded against

#### Scenario: The outlet is not asked for when it is not ambiguous

- **WHEN** an admin records an arrival while one outlet is in scope
- **THEN** no outlet question is shown and the arrival is recorded there

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

### Requirement: A person's own attendance spans every outlet they work at

The person's own attendance history SHALL list the days they worked at every
outlet they hold or held an assignment at, each entry naming its outlet, as one
combined history rather than one list per outlet. A person who has only ever
worked at one outlet SHALL see what they see today.

A business date SHALL appear once in that history and SHALL be counted once in
its summary, so a person who works at two outlets never reads as present at one
and absent at another on the same day.

#### Scenario: A day worked at one of two outlets appears once

- **WHEN** a person assigned to two outlets checks in at one of them and opens
  their own attendance
- **THEN** the day appears once, naming the outlet it was worked at, and does
  not also appear as absent at the other

#### Scenario: A month mixes outlets without duplicating days

- **WHEN** a person works some days at one outlet and other days at the other,
  and reads the month
- **THEN** each business date appears once with the outlet it was worked at, and
  the summary counts each day once

#### Scenario: A single-outlet person sees no new chrome

- **WHEN** a person who holds one assignment opens their own attendance
- **THEN** the view is as it was, with the outlet named but nothing to choose

## ADDED Requirements

### Requirement: A person accounted for at another outlet reads as elsewhere, not absent

The database SHALL answer, for an outlet and a business date, which people **on
that outlet's own staff list** hold an attendance row at some other outlet that
day. This exists because a reader who may see one outlet cannot see rows written
at another, and so cannot themselves tell a person who was absent from a person
who worked elsewhere. Without it, the surface would state that somebody was
absent on a day they worked, which is a false claim about their pay.

That answer SHALL disclose nothing beyond the fact itself. It SHALL NOT reveal
which outlet, the arrival time, the status, the location evidence, the approver,
or whether the day was approved, and it SHALL be limited to people the reader
already sees on their own outlet's staff list.

The surface SHALL render such a person as working at another outlet that day,
without naming the outlet, and SHALL NOT show them as absent, as not yet arrived,
or as carrying a row. Where the reader's selection already covers the outlet the
person attended, their real row SHALL be shown instead and no elsewhere reading
SHALL appear.

#### Scenario: A single-outlet manager sees why somebody is not on their day

- **WHEN** a person staffed at two outlets checks in at one of them, and the
  other outlet's Franchise Admin opens that business day
- **THEN** that person is listed as working at another outlet that day, is not
  shown as absent, and no outlet name, time or evidence is shown for them

#### Scenario: The detail behind the fact is still refused

- **WHEN** that same Franchise Admin hand-crafts a request for the attendance row
  itself at the other outlet
- **THEN** the database returns no row

#### Scenario: Selecting both outlets shows the real row instead

- **WHEN** a reader who may see both outlets selects both and opens that day
- **THEN** the person is listed once with their actual row at the outlet they
  attended, and no working-elsewhere line is shown

#### Scenario: A genuine absence still reads absent

- **WHEN** a person staffed at two outlets holds no row at any outlet on a
  business date whose deadline has passed
- **THEN** they read as absent, once
