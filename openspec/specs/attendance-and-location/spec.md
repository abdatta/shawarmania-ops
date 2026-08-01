# Attendance And Location

## Purpose

Makes a disputed day reviewable instead of a black box. Every attendance row stores the captured
coordinates, GPS accuracy, computed distance and source beside the verdict, for the check-in and for
the approval that settles it. A check-in is a claim and counts for nothing on its own: only a
recorded approval makes a day present, and an approval given away from the outlet or after the day
closed carries the approver's position and their written reason. These requirements bind what the
schema records, what the geofence may and may not decide, and what every surface must show about it.

## Requirements

### Requirement: Attendance stores the evidence beside the verdict

Every attendance row SHALL be able to record, for the check-in and for the
approval that settles it independently: the captured coordinates, the GPS
accuracy, the computed distance from the outlet, and, for the check-in, the
source (own phone or counter tablet) — so a disputed day is reviewable from
stored inputs rather than a bare verdict. An approval SHALL record who
approved, when, where they were, and, where the rule requires one, why.

#### Scenario: A check-in is recorded

- **WHEN** an attendance row is written with check-in location data
- **THEN** the row stores the coordinates, accuracy, computed distance, and source together with the attendance status

#### Scenario: An approval is recorded

- **WHEN** a manager approves a check-in
- **THEN** the row stores the approver's identity, the approval time, the
  approver's coordinates and accuracy where the device supplied them, and the
  distance the database computed from those coordinates

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

### Requirement: A closed outlet accepts no new check-ins

A check-in recorded against an outlet whose active state is off SHALL be
refused, and the refusal SHALL name the reason so that the person holding the
phone learns the shop is marked closed rather than that something broke.

An approval SHALL NOT be refused for this reason. A day worked before the
outlet closed must still be settleable afterwards.

#### Scenario: Check-in at a deactivated outlet

- **WHEN** an employee attempts to check in and their outlet is deactivated
- **THEN** the check-in is refused by the database, and the surface explains
  that the outlet is marked closed

#### Scenario: An earlier day is still approvable after deactivation

- **WHEN** an outlet is deactivated while one of its days is still waiting for
  approval
- **THEN** a manager can still approve that day

#### Scenario: Reactivating restores check-in

- **WHEN** a deactivated outlet is reactivated
- **THEN** check-ins are accepted again with no other intervention

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
- **THEN** the screen shows the recorded arrival and its waiting or approved state, and offers no second check-in at that outlet

#### Scenario: A multi-outlet person is offered no second outlet

- **WHEN** a person assigned to two outlets has a recorded arrival today and
  opens their home screen
- **THEN** no action is offered to check in at another outlet

### Requirement: An outlet has an arrival deadline, and every check-in records the one that applied

Each outlet SHALL carry an arrival deadline, a time of day defaulting to
13:00, alongside its business-day cutover. The database SHALL stamp the
outlet's deadline onto each attendance row when its check-in first lands,
taking it from the outlet and never from the client, and SHALL freeze it
thereafter with the rest of the captured evidence.

Whether an arrival was late SHALL be judged against the deadline stamped on
the row, in the outlet's local reckoning of the business day, so that later
editing an outlet's deadline never changes how an already recorded day reads.

#### Scenario: The deadline is stamped at check-in

- **WHEN** a check-in is recorded at an outlet whose arrival deadline is 13:00
- **THEN** the row stores 13:00 as the deadline that applied

#### Scenario: Changing the outlet's deadline does not rewrite history

- **WHEN** an outlet's arrival deadline is changed after days have been
  recorded under the old one
- **THEN** every existing row is still judged against the deadline stamped on
  it, and days already recorded do not change between late and on time

#### Scenario: A client cannot choose its own deadline

- **WHEN** an attendance row is written naming a deadline other than the
  outlet's
- **THEN** the stored deadline is the outlet's

### Requirement: A late arrival is recorded, tagged, and given no different status

A check-in after the row's stamped arrival deadline SHALL be recorded with its
real time and its full evidence, exactly as an on-time one, and SHALL be shown
as late wherever attendance is read: the manager's day, the person view, and
the employee's own history.

Lateness SHALL NOT be a status and SHALL NOT change the approval rule. An
approved late day is present and late; whether lateness costs half a day
remains a manager's decision recorded in the status.

#### Scenario: An employee checks in after the deadline

- **WHEN** an Employee checks in at 14:20 at an outlet whose stamped deadline
  is 13:00
- **THEN** the row is recorded with the real arrival time and evidence, and
  reads as late everywhere it appears

#### Scenario: An approved late day is present

- **WHEN** a manager approves a late arrival
- **THEN** the day's status becomes present and the late tag remains

#### Scenario: A manual entry after the deadline is late too

- **WHEN** an admin records a manual check-in at a time after the row's stamped
  deadline
- **THEN** the day reads as late, on the same terms as a phone check-in

### Requirement: No check-in by the deadline reads absent

A person holding a live assignment SHALL read as absent on every
surface — the manager's day, the person view, the employee's own history, and
every count derived from them — once that outlet's arrival deadline for a
business day has passed with no attendance row recorded for them **anywhere**
that day. Before that deadline has passed, the same person SHALL read as not yet
arrived.

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
  a staff member has no attendance row
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

### Requirement: The geofence verdict is computed by the database from the stored evidence

The database SHALL compute the stored check-in distance and the stored
approver distance from the submitted coordinates and the outlet's recorded
position, disregarding any distance supplied by the client.

A check-in SHALL NOT be recorded with status present, whatever its distance:
the fence is evidence, and only a recorded approval settles a day. The fence
therefore never imposes a status either — a manager marking leave or half day
on an in-fence day is stored as written.

#### Scenario: A client submits a distance that contradicts its coordinates

- **WHEN** an attendance row is written with coordinates far from the outlet but a small claimed distance
- **THEN** the stored distance is the one computed from the coordinates, not the claimed one

#### Scenario: An in-fence check-in is not present on its own

- **WHEN** an Employee writes an attendance row with status present and
  coordinates well inside the outlet's geofence radius, and no approval is
  recorded
- **THEN** the stored row has status absent and reads as waiting for a manager

#### Scenario: An employee attempts to record themselves present from outside the fence

- **WHEN** an Employee writes an attendance row with status present and coordinates beyond the outlet's geofence radius, and no approval is recorded
- **THEN** the stored row has status absent

#### Scenario: A manager marks a leave day for someone inside the fence

- **WHEN** a Franchise Admin sets a status other than present on an attendance row whose check-in was inside the fence
- **THEN** the status is stored as written, because the fence never imposes a status

#### Scenario: The outlet has no captured position

- **WHEN** an Employee checks in at an outlet whose coordinates have not been captured
- **THEN** the check-in is recorded, the distance is stored as unknown, and both the employee's and the manager's views state that the outlet has no captured position rather than showing a distance

#### Scenario: The counter tablet checks someone in

- **WHEN** an enrolled counter device records a check-in with no coordinates
- **THEN** the row is recorded and waits for approval like any other, because the device stands in the outlet but does not decide who worked

### Requirement: A blocked check-in explains itself and offers a way through

A check-in taken beyond the outlet's geofence radius SHALL present the reason,
how far outside the radius the reading was, the accuracy of that reading, and
an action to record it anyway for the manager to settle. Showing that state
SHALL NOT record an attendance row until the employee chooses to record it.

The screen SHALL say that a manager approving it will have to give a reason,
so the person understands what they are asking for.

#### Scenario: An employee is outside the fence

- **WHEN** an Employee taps check-in and the device reports a position beyond the outlet's geofence radius
- **THEN** the check-in is not yet recorded and the screen states the distance beyond the fence, the reading's accuracy, and offers to record it for a manager to settle

#### Scenario: An employee abandons a blocked check-in

- **WHEN** an Employee is shown the blocked state and does not choose to record it
- **THEN** no attendance row exists for them for that business day

#### Scenario: An employee records it anyway

- **WHEN** an Employee chooses to record a check-in from the blocked state
- **THEN** an attendance row is recorded for the business day carrying the check-in time and full location evidence, with status absent, and the outlet's manager sees it as waiting for approval

#### Scenario: The device cannot supply a position

- **WHEN** location permission is denied, unavailable, or times out
- **THEN** the screen states which of those happened and offers the same record-it-anyway path, rather than failing with a generic error

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

#### Scenario: A reading is not reused across outlets

- **WHEN** a manager viewing two outlets at once approves a row at one outlet
  and then a row at the other within the same minute
- **THEN** the second approval does not reuse the first reading, and the second
  row is judged against its own outlet's fence

#### Scenario: A run of approvals reads the position once

- **WHEN** a manager approves several waiting days one after another, within a
  minute of the first
- **THEN** the position is read once and reused, and each row still records its
  own approver, time, position and computed distance

### Requirement: An approval records where the approver was, and being elsewhere costs a reason

Recording an approval SHALL read the approving device's position at that
moment, and the database SHALL compute the approver's distance from the outlet
from those coordinates, disregarding any distance a client supplies.

An approval SHALL require a reason, which SHALL NOT be blank, unless the
approver's reading is inside the outlet's geofence radius and the approval is
recorded on the row's own business day. Being outside the fence, supplying no
position at all, and settling a business day that has already closed SHALL
each require a reason, and the database SHALL refuse the write without one.

No approval SHALL be refused on the grounds of distance alone. Every surface
that shows an approval SHALL show whether the approver was at the outlet, so
that approving from elsewhere is visible rather than prevented.

#### Scenario: On site, on the day, one action

- **WHEN** a Franchise Admin approves a waiting day from inside the outlet's
  geofence on that day, giving no reason
- **THEN** the approval is recorded, and the row shows that the approver was
  at the outlet

#### Scenario: Away from the outlet without a reason

- **WHEN** an approval is written from beyond the outlet's geofence radius with
  no reason
- **THEN** the database refuses it

#### Scenario: Away from the outlet with a reason

- **WHEN** an approval is written from beyond the outlet's geofence radius with
  a reason
- **THEN** it is recorded, the row keeps the approver's distance, and every
  surface reading it shows that the approver was not at the outlet, with their
  reason

#### Scenario: No position at all

- **WHEN** the approving device can supply no position
- **THEN** the approval is treated exactly as an off-site one: a reason is
  required, and the row records that the approver's position is unknown

#### Scenario: Settling a day that has already closed

- **WHEN** an approval is recorded on a business day later than the row's own,
  even from inside the outlet's geofence
- **THEN** a reason is required, and the row records when the approval was made

#### Scenario: An unsurveyed outlet cannot vouch for anyone

- **WHEN** an approval is recorded at an outlet whose position has never been
  captured
- **THEN** a reason is required, and the surfaces state that the outlet has no
  captured position rather than claiming the approver was on site

### Requirement: An employee sees exactly what their manager sees

An Employee's own attendance history SHALL show, for each of their days, the
same facts the outlet's manager sees about that day: the check-in time,
status, distance, accuracy, source, whether it was late, and the approval with
its approver, whether that approver was on site, and any reason they gave.

#### Scenario: An approved day in the employee's history

- **WHEN** an Employee views a day that a manager approved
- **THEN** the entry shows the approval, who approved it, whether they were at
  the outlet when they did, and any reason they gave

#### Scenario: A late day in the employee's history

- **WHEN** an Employee views a day whose check-in was after the outlet's
  arrival deadline
- **THEN** the entry shows the same late tag and the same arrival time the
  manager's view shows

### Requirement: A manager reviews the outlet's attendance day

A Franchise Admin SHALL be able to view attendance for a chosen business day
across one or more of the outlets they hold a live assignment at, showing for
each person listed the check-in time, the
distance and accuracy of the reading, the source, whether it was late, whether
it is waiting for approval, and any flags, and SHALL be able to approve waiting
days and record manual entries from that view. A Super Admin SHALL be able to
view any outlets on the same terms, whether or not they hold an assignment there.

Where more than one outlet is in scope, each listed row SHALL name the outlet it
belongs to, and a person appearing at one of the selected outlets SHALL be listed
once rather than once per outlet.

**Who is listed is a question about staff.** The view SHALL list every person
holding a live **staff** assignment at an outlet in scope, and SHALL NOT list a person
merely because they hold a manager or counter assignment there: attendance is
recorded for the people whose arrival the outlet tracks, and a manager or an
owner is not one of them. A person holding a staff assignment alongside any other
SHALL be listed, because their attendance is a real thing.

The view SHALL additionally list any person carrying a recorded row on the day
shown, whatever assignment they hold, so that every recorded day is visible and
every count computed from rows can be settled. A person whose account is
deactivated but who has not left SHALL still be listed — cutting access does not
falsify the day.

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
chosen day changes, so that settling a day never moves the rows beneath it.

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
  person view
- **THEN** both show the same status, time, evidence, late tag and approval

#### Scenario: A manager cannot read another outlet's days for the same person

- **WHEN** a Franchise Admin hand-crafts a request for a person's days naming an
  outlet they hold no live assignment at
- **THEN** no rows are returned for that outlet

#### Scenario: An employee reads their own month across outlets

- **WHEN** a person who works at two outlets reads their own attendance over a
  range
- **THEN** every day is listed, each naming the outlet it was worked at

### Requirement: Days waiting for approval are visible to the owner across outlets

A Super Admin SHALL be able to see, without opening each outlet in turn, how
many days are waiting for approval at each outlet. A day nobody settles is
otherwise invisible until somebody queries their pay.

Each outlet holding unsettled days SHALL be shown with its own count. Choosing
one SHALL bring the view to that outlet, so noticing a stranded day and acting
on it are one gesture rather than a count followed by hunting through a picker.
The outlet already in scope SHALL be shown as such rather than offered as
somewhere to go.

This SHALL be shown only while some outlet **other than the one in scope** holds
unsettled days. Where the outlet in scope is the only one, nothing SHALL be
shown: the view already names that outlet and already states whether it holds
work on other days, and a lone entry about where the reader already is repeats
both while pointing nowhere.

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

#### Scenario: Only the outlet in scope holds unsettled days

- **WHEN** a Super Admin opens attendance and the outlet in scope is the only
  one holding unsettled days
- **THEN** no cross-outlet list is shown at all

#### Scenario: A manager sees only their own

- **WHEN** a Franchise Admin opens attendance
- **THEN** no other outlet's unsettled days are shown to them

### Requirement: An admin records attendance on someone's behalf

A Franchise Admin SHALL be able to record a check-in for a person at their own
outlet, and a Super Admin for a person at any outlet, at a past or current
time on the outlet's current business day — never a future time. This is the
escape hatch that keeps a hard arrival rule humane: the phone died, the person
forgot, the network was down.

Where more than one outlet is in scope and the person holds a staff assignment
at more than one of them, the entry SHALL ask which outlet it is being recorded
against. Where the outlet is unambiguous, nothing SHALL be asked.

A manual entry SHALL be stamped by the database with who entered it — the
enterer's id and a snapshot of their name, never client-supplied — and with a
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

### Requirement: A manager maintains the outlet's staff list

A Franchise Admin SHALL see, on their outlet's people surface, every person
holding a live assignment at that outlet — and only those people. A person
assigned to two outlets SHALL appear on both outlets' people lists, and each
manager SHALL see only the attendance rows worked at their own outlet.

The outlet's **attendance** day is a narrower list, and deliberately so: it is
the people holding a live staff assignment there, plus anybody carrying a row on
the day shown. A manager appears on their outlet's people surface always and on
its attendance day only when they are also staff there.

#### Scenario: A multi-outlet person appears on both lists

- **WHEN** a person holds live staff assignments at both outlets and each
  manager opens their own outlet's attendance day
- **THEN** the person appears on both, and each manager sees only the rows
  worked at their own outlet

#### Scenario: A manager is on the people list and not on the day

- **WHEN** a Franchise Admin holding no staff assignment at their outlet opens
  that outlet's people surface and then its attendance day
- **THEN** they appear on the people surface and not on the attendance day

#### Scenario: Ending an assignment removes them from that list only

- **WHEN** a person's assignment at one outlet is ended
- **THEN** they leave that outlet's people list and its new attendance days, and
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

### Requirement: Location is captured only at check-in, at approval, and at an outlet capture

The application SHALL read a device's position only in direct response to a
check-in, an approval, or an outlet position capture. It SHALL NOT observe
position in the background, on a schedule, or while any screen merely sits
open. This binds the approving manager's device exactly as it binds the
employee's.

#### Scenario: An employee leaves the app open

- **WHEN** the Employee home screen is open and no check-in is attempted
- **THEN** no position is read and nothing is stored

#### Scenario: A manager leaves the day view open

- **WHEN** the outlet attendance day is open and no approval is recorded
- **THEN** no position is read and nothing is stored

### Requirement: The geofence decides which outlet a person is checking in at

A person holding live assignments at more than one outlet SHALL check in from
the same single action as everybody else. Wherever a position reading exists, the
outlet SHALL be resolved from where they are standing and SHALL NOT be chosen by
them:

- Holding one assignment, that outlet is used — unchanged from single-outlet
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
  absent, and the manager of that outlet can settle it with a reasoned
  approval

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
