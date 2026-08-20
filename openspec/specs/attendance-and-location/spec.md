# Attendance And Location

## Purpose

Makes a disputed day reviewable instead of a black box. Every attendance row stores the captured
coordinates, GPS accuracy, computed distance and source beside the verdict, for the check-in and for
the approval that settles it. A check-in is a claim and counts for nothing on its own: only a
recorded approval makes a day present, and an approval given away from the outlet or after the day
closed carries the approver's position and their written reason. These requirements bind what the
schema records, what the geofence may and may not decide, and what every surface must show about it.
## Requirements
### Requirement: A staff assignment, for attendance, is Employee or Biller

Every requirement in this capability that turns on a **staff assignment** SHALL
read that term as a live `employee` **or** `biller` assignment at the outlet in
question. Attendance is recorded for the people whose arrival an outlet tracks,
and somebody who works a shift on its counter tablet is one of them.

This restates for attendance what `identity-and-access` already requires of the
assignment itself: a live Biller assignment confers personal attendance and
Employee surface capabilities at that outlet, and promoting an Employee to
Biller leaves their attendance history unchanged. The term SHALL be stated as
the roles it admits rather than as the roles it excludes, so that a role added
to the enum later joins no outlet's attendance list until somebody decides that
it should.

A Franchise Admin or Super Admin assignment SHALL NOT by itself make its holder
staff anywhere, and holding one alongside a staff assignment SHALL NOT take that
staff assignment away.

#### Scenario: A Biller is on the outlet's attendance day

- **WHEN** a person holding a live Biller assignment and no Employee assignment
  at an outlet is read on that outlet's attendance day, on a date they carry no
  record
- **THEN** they are listed as staff whose arrival is expected, on the same terms
  as an Employee, and not as somebody off the staff list

#### Scenario: A Biller is offered by the by-staff axis

- **WHEN** a reader selects an outlet where a person holds a live Biller
  assignment and reads by staff
- **THEN** that person is offered, and their range reads on the same terms as an
  Employee's

#### Scenario: Promotion from Employee to Biller keeps the person on the list

- **WHEN** an Employee is changed to Biller at the same outlet, ending the
  Employee assignment on the day of the change
- **THEN** they remain on that outlet's attendance day and in its by-staff axis
  without interruption, and every day they worked under either assignment stays
  listed and readable

#### Scenario: A manager is still not staff

- **WHEN** a person holding only a live Franchise Admin assignment at an outlet
  is read on that outlet's attendance day
- **THEN** they are not listed, and holding the manager assignment alongside a
  Biller assignment at that outlet SHALL list them

#### Scenario: A Biller accounted for elsewhere is not read as absent

- **WHEN** a person holding a live Biller assignment at the reader's outlet
  holds that day's attendance row at an outlet outside the reader's scope
- **THEN** they read as working at another outlet, without the outlet being
  named, and SHALL NOT read as absent or as not yet arrived

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
status without navigating away from it. Each check-in attempt SHALL capture the
device's coordinates and reported accuracy at the moment of the action, and
store them together with the database-computed distance, the target outlet,
the target outlet's stamped arrival deadline and the source.

An initial recorded attempt SHALL count as nothing until a manager approves it,
and the screen SHALL say so plainly rather than implying the day is done. Where
a manager has already denied the day, a newer pending attempt SHALL leave the
outcome absent and SHALL be shown as awaiting review in addition to that
outcome. Only approval changes it to present.

The screen SHALL offer no further employee check-in when the newest pending
attempt is inside the fence, when a manager prevented retry, or when the day is
approved, manually settled, leave or half day. It SHALL offer retry when the
newest pending attempt is outside or unverifiable, or when the latest denial
left retry open, subject to the target outlet still reckoning the same explicit
business date as current.

#### Scenario: An employee checks in inside the fence

- **WHEN** an Employee taps check-in and the device reports a position within the outlet's geofence radius
- **THEN** an attempt is recorded for the current business day with the check-in time, outlet, coordinates, accuracy, database-computed distance, stamped deadline and source `phone`, and the screen states that it is waiting for their manager

#### Scenario: An inside pending attempt cannot be replaced

- **WHEN** an Employee whose newest pending attempt is inside the fence opens their home screen
- **THEN** the recorded arrival and waiting state are shown and no further check-in action is offered

#### Scenario: A weak pending attempt can be retried

- **WHEN** an Employee's newest pending attempt is outside the fence or has unverifiable location
- **THEN** the screen offers another check-in while preserving the existing attempt

#### Scenario: A denied day stays absent during retry review

- **WHEN** an Employee records a permitted new attempt after a manager denied the day
- **THEN** the day remains absent and also reads as awaiting review until a manager approves the new attempt

#### Scenario: An approved day cannot be reopened by the employee

- **WHEN** an Employee whose day is approved opens their home screen
- **THEN** the approved outcome is shown and no re-check action is offered

#### Scenario: A multi-outlet retry does not create a second outcome

- **WHEN** a person assigned to two outlets retries at the other assigned outlet for the same business date
- **THEN** the new attempt may become the one awaiting review but the person still has exactly one attendance outcome for that date

### Requirement: A self check-in uses one database-authored arrival instant

Every phone self check-in attempt SHALL take its arrival instant from the database
statement that accepts it, including a retry and an attempt carrying no position.
The database SHALL write that instant as the immutable attempt time
and the canonical check-in time, and SHALL derive the attempt's explicit
business date from the same instant and the target outlet's business-day
cutover in Asia/Kolkata.

A timestamp reported by the employee's device or its geolocation reading SHALL
NOT decide whether the attempt is accepted, which business date it belongs to,
whether it is late, or what arrival time is stored. Coordinates and reported
accuracy SHALL remain immutable device evidence and distance SHALL remain a
database-computed verdict from that evidence.

This clock rule SHALL apply only to self check-ins. A manual arrival or an
authorised time correction SHALL keep the manager-supplied asserted arrival
time and the database SHALL continue to stamp separately who made that
assertion and when.

#### Scenario: A phone clock ahead of the database does not block arrival

- **WHEN** an assigned employee submits a valid self check-in whose device or
  geolocation timestamp is later than the database clock
- **THEN** the database accepts the attempt, stores its own acceptance instant
  as the arrival, and does not record the submitted future timestamp as the
  check-in time

#### Scenario: A phone clock behind the database cannot backdate arrival

- **WHEN** an assigned employee submits a valid self check-in whose device or
  geolocation timestamp is earlier than the database clock
- **THEN** the database stores its own acceptance instant and the employee
  cannot use the earlier value to appear on time or move the attempt to an
  earlier business date

#### Scenario: A position-free attempt has the same clock authority

- **WHEN** an employee records a permitted self check-in after the device could
  not supply a position
- **THEN** the attempt stores the database acceptance instant with unknown
  coordinates, accuracy and distance, and waits for a manager on the same terms
  as any other unlocated arrival

#### Scenario: The outlet cutover is crossed on a skewed phone

- **WHEN** the employee's phone and the database disagree about which side of
  the target outlet's cutover the present instant falls on
- **THEN** the attempt is written once with the business date derived by the
  database from its own instant and that outlet's cutover

#### Scenario: Server time decides lateness

- **WHEN** the submitted device timestamp is before the stamped arrival
  deadline but the database accepts the self check-in after that deadline
- **THEN** the stored arrival reads late everywhere, using the database-authored
  attempt time and the deadline stamped from the outlet

#### Scenario: A manual historical arrival keeps the manager's asserted time

- **WHEN** an authorised manager records a valid earlier arrival on the
  outlet's current business day
- **THEN** the row stores the manager-supplied arrival time while separately
  recording the manager and database decision time, and the self-check-in clock
  rule does not replace it with the submission instant

### Requirement: Employee attendance receives current outlet dates from the backend

The attendance adapter SHALL provide the employee surfaces with one
backend-authored reference instant and the current explicit business date for
each requested outlet the caller may read. Every date in one response SHALL be
derived from the same reference instant and that outlet's own cutover.

The employee home and own-attendance surfaces SHALL use this context to choose
which current dates to read, label the current day, decide whether a retry
target still calls the canonical date current, and preview whether a retry
changes between on time and late. They SHALL NOT use the device clock as the
authority for those attendance decisions.

The context SHALL disclose nothing for an outlet the caller cannot read and
SHALL grant no attendance authority. The database write SHALL remain final if
a deadline or cutover passes after the context was read.

#### Scenario: A skewed phone opens the correct attendance day

- **WHEN** an employee opens attendance while their device clock would resolve
  a different date from the backend for an assigned outlet
- **THEN** the surface queries and labels the date supplied by the backend and
  shows any row recorded for that server-reckoned day

#### Scenario: Assigned outlets have different cutovers

- **WHEN** one backend reference instant falls on different business dates at
  two outlets assigned to the same person
- **THEN** the context returns each outlet's own date and the employee surface
  reads the distinct dates without deriving either from the phone clock

#### Scenario: Another outlet's time context is not disclosed

- **WHEN** an Employee hand-crafts a current-context request naming an outlet
  they cannot read
- **THEN** no context row for that outlet is returned and naming it confers no
  attendance read or write authority

#### Scenario: The day rolls over after context was read

- **WHEN** an employee prepares an attempt using current context and the target
  outlet crosses its cutover before the write is accepted
- **THEN** the database's write-time instant decides the business date for a
  first attempt, while a retry of an older canonical date is refused as no
  longer current and the surface reloads backend context

### Requirement: Self check-in replay preserves its first server-authored facts

A self check-in command SHALL remain idempotent by its client-generated attempt
UUID. The first accepted execution SHALL freeze the database-authored attempt
time and business date. An exact later execution SHALL return that same attempt
without replacing either fact with the later execution's server time, including
when the replay arrives after a cutover. Reusing the UUID with changed client
evidence or intent SHALL remain a refusal.

#### Scenario: An exact request is replayed after the outlet rolls over

- **WHEN** a client loses the response to an accepted self check-in and sends
  the exact same command again after the target outlet has entered another
  business date
- **THEN** the database returns the one original attempt with its first
  server-authored time and date and creates no second history row

#### Scenario: Server execution time is not a changed payload

- **WHEN** the exact same attempt UUID and client payload execute more than once
  at different database times
- **THEN** idempotency compares the client command facts, does not fingerprint a
  newly generated server instant, and returns the original result

#### Scenario: Changed evidence under one id is still refused

- **WHEN** a client reuses an accepted attempt UUID with different outlet,
  coordinates, accuracy, requested date, requested timestamp or expected state
- **THEN** the database refuses the changed reuse and preserves the original
  attempt unchanged

### Requirement: A manager can deny one pending attendance attempt

A Super Admin, or a Franchise Admin holding a live assignment at the pending attempt's outlet, SHALL
be able to deny that attempt. A
denial SHALL mark the canonical day absent, record the acting manager and
database time, require a non-blank editable reason, and record whether the
manager prevented another employee check-in that business day.

The denial form SHALL contain the required reason, one retry-prevention
checkbox, and, where a set is being denied, the shared consequence of that
choice. The checkbox SHALL always be unchecked when the form opens. A measured
outside attempt SHALL prefill the reason as `Check-in was outside the outlet
geofence`; an unverifiable attempt SHALL prefill `Check-in location could not be
verified`. Prefill SHALL remain editable and SHALL NOT replace database
enforcement of a non-blank reason.

Denial SHALL NOT read or store the manager's position, because it does not
vouch for presence.

Where several attempts are denied in one action, they SHALL be denied on these
same terms, sharing one reason and one retry choice.

#### Scenario: A manager denies an outside attempt

- **WHEN** an authorised manager opens Deny on a measured outside-fence attempt
- **THEN** the reason is prefilled, the retry-prevention checkbox is unchecked, and submitting a non-blank reason records the denial and marks the day absent

#### Scenario: An unverifiable attempt receives an honest prefill

- **WHEN** an authorised manager opens Deny on an attempt with no usable fence result
- **THEN** the reason says the location could not be verified rather than claiming the employee was away

#### Scenario: A blank denial is refused

- **WHEN** a manager submits a blank or whitespace-only denial reason, including through a hand-crafted request
- **THEN** the database refuses the denial and the attempt remains pending

#### Scenario: Denial collects no manager location

- **WHEN** a manager denies a pending attempt
- **THEN** no position request is made on the manager's device and the decision stores no manager coordinates

#### Scenario: A manager prevents retry

- **WHEN** the manager checks `Prevent another check-in today` before denying
- **THEN** the day is absent and the employee is refused another attempt at every outlet for that business date

### Requirement: Eligible retries preserve evidence and may move to another assigned outlet

A retry SHALL append a new immutable attempt and SHALL NOT edit or delete any
earlier attempt. A newer attempt SHALL supersede the previous pending attempt
for action purposes, and at most one attempt per person and business date SHALL
be current and waiting.

Where retry is permitted, the geofence SHALL resolve the target from every
outlet where the person holds a live staff assignment, on the same terms as an
initial multi-outlet check-in. The target outlet SHALL be active and SHALL
reckon the canonical row's explicit business date as its current business date.
The target's deadline SHALL be stamped on the new attempt and lateness SHALL be
judged from the new attempt's real time.

Retry SHALL remain available while the newest pending evidence is outside or
unverifiable. A newest in-fence pending attempt SHALL close employee retry until
a manager decides it. A denial that leaves retry open SHALL permit a new
attempt at any live assigned outlet; a denial that prevents retry SHALL permit
none.

#### Scenario: Repeated outside readings remain retryable

- **WHEN** an eligible employee retries and the newest reading is still outside the fence
- **THEN** the new immutable attempt becomes current and another retry remains available

#### Scenario: An inside retry waits without another retry

- **WHEN** an eligible employee retries and the newest reading is inside the fence
- **THEN** that attempt becomes current and waiting, and the employee is offered no further retry until a manager decides it

#### Scenario: Wrong-outlet denial can recover at the correct outlet

- **WHEN** a multi-outlet person's attempt is denied with retry left open and they next check in at another live assigned outlet
- **THEN** the other outlet's attempt becomes current and waits for that outlet's manager while the day remains absent

#### Scenario: An unassigned outlet is refused

- **WHEN** an employee hand-crafts a retry naming an outlet where they hold no live staff assignment
- **THEN** the database refuses the attempt and naming the outlet confers no access

#### Scenario: A differing cutover cannot move the retry to another date

- **WHEN** a target outlet no longer reckons the canonical row's business date as current
- **THEN** the database refuses the employee retry at that outlet rather than deriving or changing the business date

#### Scenario: Approval closes employee retry globally

- **WHEN** any manager approves the current attempt for a person and business date
- **THEN** the employee is refused another attempt at every outlet for that date

### Requirement: A material retry change is confirmed once before writing

Before a retry is stored, the employee surface SHALL compare the candidate
attempt with the current attempt. A change of outlet, on-time/late
classification, or inside/outside/unverifiable fence result SHALL be material.
Where one or more material facts change, one confirmation SHALL list every
before-and-after change and offer `Use new check-in` and `Keep existing
check-in`. Nothing SHALL be written until the employee confirms. No
confirmation SHALL appear when no material fact changes.

The confirmation SHALL grant no authority and SHALL NOT reserve the state. The
database SHALL still re-check retry eligibility and the expected current
version when the confirmed command arrives.

#### Scenario: Several facts change in one retry

- **WHEN** a retry would move outlet, change on-time to late and change outside to inside
- **THEN** one confirmation lists all three changes and no attempt is written before `Use new check-in` is chosen

#### Scenario: The employee keeps the existing attempt

- **WHEN** a material-change confirmation is shown and the employee chooses `Keep existing check-in`
- **THEN** no new attempt exists and the current evidence and waiting outlet are unchanged

#### Scenario: No material fact changes

- **WHEN** an eligible retry has the same outlet, lateness and fence classification as the current attempt
- **THEN** it may be submitted without an extra confirmation

#### Scenario: State changes while confirmation is open

- **WHEN** a manager decides the attempt after the employee opens confirmation but before the retry command arrives
- **THEN** the database refuses the stale retry and the employee reloads the decided state

### Requirement: Manager corrections are append-only and unobtrusive

An authorised manager SHALL be able to correct the current outcome, retry
permission, or effective check-in time without deleting or editing a prior
attempt, approval, denial or correction. Every correction SHALL append the
acting manager, database time, required non-blank reason, and the previous and
new value being corrected.

Ordinary waiting rows SHALL show Approve and Deny. Settled rows SHALL not carry
a permanent row of correction buttons; one unobtrusive `Correct attendance`
entry point in expanded details SHALL show only actions relevant to the current
state: mark absent, mark present, allow another check-in, mark absent and allow
another check-in, or change check-in time. Selecting `Change check-in time`
SHALL reveal one mandatory time field in the same correction sheet.

A correction to present SHALL use the latest recorded employee attempt and
SHALL capture the manager's position under the same on-site, same-business-day
reason rule as approval. It SHALL NOT invent a later employee position or
arrival time. A correction to absent or retry permission SHALL not read manager
position.

A check-in-time correction SHALL be available only for a settled attendance
record with a recorded arrival. It SHALL preserve the original attempt and all
of its location or manual-entry evidence, append the previous and corrected
times, and make the corrected time the effective arrival used wherever the day
is read or lateness is derived. It SHALL accept historical settled days, refuse
a future time, and refuse a time that belongs to a different business date
under the recorded outlet's cutover. Repeated time corrections SHALL each
append history and use the latest effective time as the next previous value.

#### Scenario: A manager corrects denied absent to present

- **WHEN** an authorised manager marks a denied day present and supplies the required reason
- **THEN** a correction and the manager's approval evidence are appended, the latest employee attempt remains unchanged, and the day becomes present

#### Scenario: A manager corrects present to absent

- **WHEN** an authorised manager marks an approved day absent and supplies a reason
- **THEN** the day becomes absent while the original approval and its evidence remain in history

#### Scenario: A manager frees a blocked employee

- **WHEN** an authorised manager chooses `Allow another check-in` on a denied day whose retry was prevented and supplies a reason
- **THEN** the day remains absent, an audited correction opens retry at any live assigned outlet, and no manager location is read

#### Scenario: A wrong approval is corrected for another outlet

- **WHEN** an authorised manager chooses `Mark absent and allow another check-in` on an incorrectly approved outlet and supplies a reason
- **THEN** the day becomes absent, retry opens globally for the business date, and the earlier approval remains visible

#### Scenario: A historical check-in time is corrected

- **WHEN** an authorised manager selects `Change check-in time` for a settled historical day, supplies another time on that same outlet business date, and gives a reason
- **THEN** the original attempt remains unchanged, a correction records the previous time, corrected time, actor, database time and reason, and every attendance reading uses the corrected time

#### Scenario: A correction changes lateness

- **WHEN** a corrected effective time crosses the arrival deadline in either direction
- **THEN** every manager and employee view derives the late tag and range tally from the corrected time and the deadline stamped on the original attempt

#### Scenario: A time correction is visible to the employee

- **WHEN** an employee opens their own attendance after an authorised manager corrected its time
- **THEN** the effective arrival shows the corrected time and history shows the original attempt plus each attributed old-to-new time correction and reason

#### Scenario: An invalid corrected time is refused

- **WHEN** a manager submits a future time or one outside the row's explicit outlet business date
- **THEN** the database refuses the command without changing the effective time, state version, or immutable history

#### Scenario: A waiting arrival cannot have its time corrected

- **WHEN** an arrival is still waiting for approval
- **THEN** `Change check-in time` is unavailable and a handcrafted correction command is refused by the database

#### Scenario: Repeated corrections preserve every value

- **WHEN** an authorised manager corrects an already corrected check-in time
- **THEN** another decision appends the current effective time and new time while every earlier attempt and correction remains visible

#### Scenario: Corrections stay out of the ordinary row

- **WHEN** a manager scans the attendance day
- **THEN** waiting rows show Approve and Deny, settled rows show their outcome, and rare correction actions are reached through one expanded-detail entry point

### Requirement: Attendance attempts and decisions are immutable and race-safe

The database SHALL preserve every attempt and manager decision as immutable
history. Check-in, retry, approval, denial and correction commands SHALL be
idempotent by client-generated UUID and SHALL atomically verify the expected
current attempt or decision. At most one command SHALL win a race for the same
person and business date; a loser SHALL receive a named stale-state refusal and
SHALL NOT partially change an outcome, waiting outlet, retry permission or
history.

#### Scenario: An exact command is retried

- **WHEN** the same attempt or decision UUID and payload reaches the database more than once
- **THEN** it produces one history row and the same resulting state

#### Scenario: An identifier is reused with a changed payload

- **WHEN** a client reuses an attempt or decision UUID with different evidence or intent
- **THEN** the database refuses the changed reuse

#### Scenario: Approval and denial race

- **WHEN** two authorised sessions approve and deny the same expected pending attempt concurrently
- **THEN** one complete decision wins and the other is refused as stale without rewriting the winner

#### Scenario: Retry and manager decision race

- **WHEN** an employee retries while a manager decides the same expected pending attempt
- **THEN** either the retry atomically moves the waiting attempt or the manager atomically decides it, never both

### Requirement: Attempt and decision evidence obeys outlet tenancy

Every attempt and decision SHALL carry `outlet_id` and SHALL be protected by
Row-Level Security. A Franchise Admin SHALL read and act on evidence only at an
outlet where they hold a live Franchise Admin assignment. An Employee SHALL
read the complete attempt and decision sequence only for their own attendance.
A Super Admin SHALL read and act across outlets. No role SHALL gain authority
from an outlet, person or manager identifier supplied in a request.

When a pending attempt moves between outlets, the former outlet's manager SHALL
retain read access to their own superseded evidence but SHALL learn nothing
about the new outlet, time, position, status, manager or decision beyond the
existing bounded `working elsewhere` fact. The new outlet's manager SHALL see
and act on the current attempt without receiving the former outlet's evidence.

#### Scenario: A Franchise Admin follows a retry to another outlet

- **WHEN** a Kalyani manager hand-crafts a read for a Kanchrapara retry and its decisions
- **THEN** Row-Level Security returns no Kanchrapara evidence

#### Scenario: A Franchise Admin acts on a superseded attempt

- **WHEN** a manager attempts to approve or deny their outlet's attempt after it was superseded by another outlet
- **THEN** the database refuses the stale action and reveals no evidence about the new attempt

#### Scenario: The employee reads their complete sequence

- **WHEN** the employee opens their own day after attempts at two assigned outlets
- **THEN** they see both attempts, their outlet names, evidence and decisions in order

#### Scenario: An unrelated employee probes the history

- **WHEN** another Employee hand-crafts a read for that person-day's attempts or decisions
- **THEN** Row-Level Security returns no rows

### Requirement: Waiting attention follows the current attempt

A person and business date SHALL contribute at most one waiting item. A current
pending attempt SHALL count at its own outlet, including when a previously
denied day remains absent. Superseding the attempt at another outlet SHALL move
the waiting item atomically. Approval or denial SHALL remove it; a later
permitted attempt SHALL add it again. Successful attendance commands SHALL
invalidate visible shared attendance reads without adding polling or an open
subscription.

#### Scenario: Retry moves manager attention

- **WHEN** a current Kalyani attempt is superseded by a permitted Kanchrapara attempt
- **THEN** the Kalyani waiting count decreases and the Kanchrapara waiting count increases in the same committed transition

#### Scenario: Denial clears waiting but records absence

- **WHEN** a manager denies the current pending attempt
- **THEN** its waiting badge disappears and the person-day reads absent

#### Scenario: A denied day receives another attempt

- **WHEN** an absent day with retry open receives a new valid attempt
- **THEN** it remains absent, contributes one waiting item at the new attempt's outlet, and shows both facts without creating a second day

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

### Requirement: An attendance command with no position is accepted

Every attendance command SHALL state each fact the database asks of it,
including the facts that are unknown. Where no position was taken, the command
SHALL say so explicitly rather than omit the coordinates and the accuracy, so
that a missing reading is a value the database records and never a request it
cannot recognise.

A check-in submitted with no position SHALL be recorded at the named outlet with
its time, unknown coordinates, unknown accuracy and unknown distance, and SHALL
wait for that outlet's manager on the same terms as any other unlocated arrival.
An approval submitted with no position SHALL be recorded and treated exactly as
an off-site one.

This SHALL hold over the transport the phone actually uses, not only against a
test double: the position-free path of each command SHALL be exercised against a
real database.

#### Scenario: A person with several assignments checks in with no position

- **WHEN** a person assigned to two outlets, whose device can supply no
  position, chooses the outlet they are at
- **THEN** the attendance row is recorded at the chosen outlet with unknown
  coordinates, unknown accuracy and unknown distance, and its manager sees it
  waiting for approval

#### Scenario: A person with one assignment records it anyway with no position

- **WHEN** a person holding one assignment, whose device can supply no
  position, chooses to record the check-in anyway
- **THEN** the attendance row is recorded at that outlet with unknown
  coordinates, and the screen states it is waiting for their manager

#### Scenario: A manager approves with no position

- **WHEN** a manager whose device can supply no position approves a waiting day
  with a reason
- **THEN** the approval is recorded, the row keeps the reason, and every surface
  reading it shows that the approver's position is unknown

#### Scenario: A position-free command is refused by nothing but its own rules

- **WHEN** either command is submitted with no position over the transport the
  phone uses
- **THEN** the database receives it, applies the same rules it applies to a
  located command, and no failure arises from the shape of the request

### Requirement: A command the backend cannot accept is reported, not retried

An attendance action that could not be sent at all SHALL be distinguished from
one refused for a reason the person can act on, and from one that may succeed on
a second attempt. Its message SHALL tell the person the action could not be sent
and ask them to report it, and SHALL NOT invite them to try again in a moment.

#### Scenario: The backend cannot resolve the command

- **WHEN** an attendance command is rejected because the backend cannot accept
  a request of that shape
- **THEN** the screen states that the action could not be sent and asks the
  person to report it, rather than presenting it as a transient failure

#### Scenario: A refusal the person can act on is unaffected

- **WHEN** an attendance command is refused by one of the rules the database
  enforces on it
- **THEN** that rule's own message is shown, unchanged by this classification

### Requirement: Only a recorded approval settles a day

A day carrying a check-in SHALL be counted present only when an approval is
recorded against it. Only a Super Admin, or a Franchise Admin holding a live
assignment at the row's own outlet, SHALL be able to record one, and the
database SHALL resolve that authority from the approving session rather than
from anything the request states. An Employee SHALL NOT be able to approve
their own day, or anyone else's.

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

#### Scenario: A whole morning cannot be approved without being selected

- **WHEN** a Franchise Admin opens a day on which several arrivals are waiting
- **THEN** the count of waiting days is stated, no control adds more than one of
  them to a set, and each is added by an action of its own before any approval

#### Scenario: A position is read for the action, not kept

- **WHEN** a manager approves, waits, and approves again
- **THEN** the second action reads the position again rather than reusing the
  first reading, however little time has passed

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

### Requirement: A manager decides an explicitly selected set in one atomic command

A Super Admin, or a Franchise Admin holding a live assignment at each selected row's own outlet, SHALL
be able to approve or deny an explicitly selected set of
waiting rows in **one database command**. The command SHALL derive the acting
manager from the authenticated session and SHALL NOT take authority from
anything the request states, and it SHALL require the same enrolled-device
condition that reading attendance requires.

The command SHALL validate every selected item before appending any decision:
the caller's authority at that item's outlet, that the item is genuinely
waiting, and that it carries the current attempt and the expected state version.
Any failure SHALL refuse the whole command, leaving every selected row exactly
as it was. It SHALL NOT be implemented as a client loop of independently
committed per-row calls.

The command SHALL lock the selected rows in a deterministic order so that a set
and a concurrent single decision cannot deadlock, and SHALL accept at most **100
items**, so that no request can ask one transaction to lock an unbounded set.

One action SHALL carry one command identity and each selected row SHALL carry
its own decision identity. Replaying the same command identity with the same
payload SHALL settle the rows once and return them. Reusing a command or
decision identity with a changed set, action, reason, retry choice or position
SHALL be refused.

The set SHALL NOT be required to share a business date. Every rule SHALL be
evaluated against each row's own outlet and its own business date.

#### Scenario: A selected set is approved in one command

- **WHEN** an authorised manager approves five individually selected waiting rows
- **THEN** all five become present, each carrying its own decision naming the
  approver, the time, the position and the computed distance to its own outlet

#### Scenario: A selected set is denied in one command

- **WHEN** an authorised manager denies four individually selected waiting rows
  with one reason
- **THEN** all four days read absent and each carries its own denial decision
  holding that reason

#### Scenario: One stale row refuses the whole set

- **WHEN** any selected item's attempt or state version no longer matches, because
  the employee retried or another manager decided it
- **THEN** the command is refused, no selected row is settled, and no decision is
  appended for any of them

#### Scenario: An unauthorised outlet in the set refuses the whole set

- **WHEN** a Franchise Admin hand-crafts a set mixing rows at their own outlet
  with a row at an outlet they hold no live assignment at
- **THEN** the database refuses the command entirely, and naming the outlet
  confers no access to it

#### Scenario: A revoked counter device is refused

- **WHEN** a session on a counter device whose enrolment has been revoked submits
  a set of any size
- **THEN** the database refuses it, on the same terms that already refuse it the
  attendance day it would be deciding

#### Scenario: A replayed command settles once

- **WHEN** the same command identity and payload arrive twice, because the first
  response was lost
- **THEN** the rows are settled once, the second call returns the same settled
  rows, and no second decision is appended for any person

#### Scenario: A replay with a changed set is refused

- **WHEN** a command identity already used is submitted again with a person added,
  removed, or with a different action, reason, retry choice or position
- **THEN** the database refuses it

#### Scenario: An oversized set is refused

- **WHEN** a hand-crafted command carries more than one hundred items
- **THEN** the database refuses it before locking or settling anything

#### Scenario: A set and a single decision run concurrently

- **WHEN** one manager submits a set containing a row while another manager
  decides that same row on its own, at the same moment
- **THEN** one succeeds and the other is refused as stale, and neither blocks the
  other indefinitely

### Requirement: One approval reading is judged independently against every selected row

Recording a set of approvals SHALL read the approving device's position **once,
in direct response to that action**, and the database SHALL compute that
reading's distance to each selected row's own outlet independently. One reading
across several outlets is one statement about where the manager was, not a claim
to have been at each of them.

A selected approval SHALL require the shared reason unless the reading is inside
**that row's** outlet geofence radius and **that row's** business date is still
current at that outlet. The database SHALL decide this per row and SHALL store
the shared reason only on the rows that require it; a row approved on the plain
terms SHALL keep no reason. Any partition the client displays SHALL be
explanatory and SHALL NOT be enforcement.

The database SHALL compute every distance from the submitted coordinates and
SHALL disregard any distance the client supplies.

#### Scenario: Inside one outlet and outside another

- **WHEN** a manager approves a selected set spanning two outlets from inside the
  first outlet's fence, on a date current at both
- **THEN** the first outlet's rows are recorded with no reason, the second
  outlet's rows require the shared reason, and each row records its own computed
  distance

#### Scenario: The reason reaches only the rows that require it

- **WHEN** that mixed set is approved with a reason supplied
- **THEN** the rows that required it store it and the rows that did not store
  none

#### Scenario: Outside every selected outlet

- **WHEN** a manager approves a selected set from beyond every selected outlet's
  radius with no reason
- **THEN** the database refuses the command

#### Scenario: No position at all

- **WHEN** the approving device can supply no position for a selected set
- **THEN** every selected approval requires the shared reason and each row
  records that the approver's position is unknown

#### Scenario: A closed business day inside the fence

- **WHEN** a selected row's business date has already closed at its outlet and the
  manager is standing inside that outlet's fence
- **THEN** that row requires the shared reason while rows whose date is still
  current do not

#### Scenario: An unsurveyed outlet cannot vouch for anyone

- **WHEN** a selected row belongs to an outlet whose position has never been
  captured
- **THEN** that row requires the shared reason and no surface claims the manager
  was on site there

#### Scenario: A set spanning two business dates

- **WHEN** a selected set contains rows from two business dates at one outlet
- **THEN** each row is judged against its own date, and no rule refuses the set
  merely for spanning dates

### Requirement: Every person joins a selected set by an action of its own

Selecting people for a decision SHALL be manual for every person. No surface
SHALL offer a control that adds more than one person to a set in one action:
there SHALL be no Select all, no select-by-outlet, no select-by-lateness, no
select-the-rest, no range selection and no press-and-hold sweep. The saving that
this capability offers is in acting on a set, never in building one.

A person SHALL be added to a set from a control on that person's own row. Only
rows currently waiting for a decision SHALL be selectable, including a waiting
row belonging to somebody who holds no staff assignment at the outlet. No count,
badge or outlet chip SHALL double as a selection control.

**A set SHALL be the whole of the selection state.** A surface SHALL NOT carry a
separate selecting mode that can exist while the set holds nobody, so selection
begins with the first person added and ends when the last one is removed. While
a set exists, the per-row decision actions SHALL stand down, so one row never
offers two ways to decide it.

Selecting a row and opening it SHALL be different acts, so that reading somebody's
evidence neither selects them nor disturbs the set already built. A row waiting
for a decision SHALL NOT be closable, because every control that decides it lives
behind that toggle and a closed one could be neither acted on nor told apart from
one already in the set.

A selection SHALL be cleared by a successful action, by leaving the day, by
changing the outlets in scope, and by cancelling. A control that clears the whole
selection at once SHALL be permitted, because it only ever removes people from
an action.

#### Scenario: A set begins and ends with the people in it

- **WHEN** a manager adds the first person to a set, and later removes the last
- **THEN** the set's actions appear on the first and are gone after the last, and
  at no point does the surface offer a set holding nobody

#### Scenario: Two selections arriving together keep both people

- **WHEN** two presses on two different rows reach the surface in one batch
- **THEN** both people are in the set, because neither press is computed from a
  view of the set that the other has already changed

#### Scenario: There is no way to select a morning at once

- **WHEN** a manager looks for a way to add every waiting person to the set in one
  action
- **THEN** no such control exists anywhere on the view, by any name

#### Scenario: A settled row cannot be selected

- **WHEN** a manager attempts to select a row that is already approved, denied or
  carries no waiting attempt
- **THEN** it cannot be added to the set

#### Scenario: A row off the staff list can be selected

- **WHEN** a waiting row belongs to a person holding no staff assignment at the
  outlet in scope
- **THEN** it can be selected and decided like any other waiting row, so the count
  that named it can be settled

#### Scenario: Opening a row does not select it

- **WHEN** a manager opens a settled row to read its evidence while a selection is
  being built
- **THEN** the row opens, no row's selected state changes, and the set is untouched

#### Scenario: A row waiting for a decision cannot be closed

- **WHEN** a manager looks at a row waiting for a decision
- **THEN** its actions are on screen and its toggle is inert, so the row cannot be
  reduced to a headline that offers no way to decide it

#### Scenario: A successful action clears the selection

- **WHEN** a set is approved or denied successfully
- **THEN** the selection is emptied, so the next action begins from nothing

### Requirement: A set of people is confirmed by name before anything is written

**Whatever is decided through a set's own action SHALL be confirmed, whatever the
size of the set.** One confirmation SHALL name every selected person, the outlet
each belongs to, and their business date where the set spans dates. Nothing SHALL
be written until that confirmation is accepted. A set of one is no exception:
building a set is a deliberate act, and the gate exists so that the manager reads
who they picked.

**The confirmation SHALL state the whole of what the decision will say**, not only
who it is about: the reason in the manager's own words where one was given, the
position reading an approval will record, and the retry choice a denial will
apply, stated whichever way it was left. Naming the people while hiding the
sentence being recorded against them would confirm half an act. Each of those
SHALL be stated once, since the step that collects a choice is where that choice
is explained.

The confirmation SHALL be the final step. Where the rule requires a reason, the
reason SHALL be collected first and the confirmation SHALL follow it, so the
people are named in the light of the explanation just written.

A decision made from a single row's own decision action SHALL NOT be confirmed
this way, because that row is the thing already being looked at.

#### Scenario: The people are named before the write

- **WHEN** a manager acts on a set of five
- **THEN** a confirmation names all five with their outlets before anything is
  recorded

#### Scenario: The confirmation follows the reason

- **WHEN** the rule requires a reason for some or all of the set
- **THEN** the reason is collected first, the confirmation follows it, and only
  accepting the confirmation writes anything

#### Scenario: Cancelling the confirmation writes nothing

- **WHEN** a manager cancels at the confirmation
- **THEN** no decision is recorded, and the selection is still there to act on

#### Scenario: The confirmation states what will be recorded

- **WHEN** a manager reaches the confirmation having given a reason, or having
  chosen whether a denied person may check in again
- **THEN** that reason is quoted back, an approval states the position it will
  record, and a denial states the retry choice either way

#### Scenario: A set of one is confirmed like any other

- **WHEN** a manager builds a set holding one person and acts on it
- **THEN** that person is named back before anything is written, and the wording
  counts in the singular

#### Scenario: A row decided from its own action is not confirmed

- **WHEN** a manager approves or denies a single waiting row from that row's own
  decision action rather than through a set
- **THEN** no confirmation step is added, because the row is already the thing
  being looked at

### Requirement: A denied set shares one reason and one retry choice

A denied set SHALL carry one non-blank reason applying to every selected person,
and one retry-prevention choice, unchecked by default, applying to every selected
person. The surface SHALL state that shared consequence explicitly, naming the
count and each row's own business date rather than saying `today`. Denial SHALL
read and store no manager position, whatever the size of the set.

Where selected attempts carry mixed evidence, the shared reason SHALL start
blank rather than prefilling a sentence that would be false for part of the set.
An evidence-derived prefill SHALL be reused only where it is true for every
selected attempt.

#### Scenario: One reason reaches every denied person

- **WHEN** a manager denies a selected set with one reason
- **THEN** every person's denial decision stores that reason

#### Scenario: The retry choice reaches every denied person

- **WHEN** a manager checks retry prevention before denying a selected set
- **THEN** every selected person is refused another attempt for that person's own
  business date, and the control said so before it was used

#### Scenario: A blank shared reason is refused

- **WHEN** a set denial is submitted with a blank or whitespace-only reason,
  including through a hand-crafted request
- **THEN** the database refuses it and every selected attempt remains waiting

#### Scenario: Mixed evidence starts the reason blank

- **WHEN** a selected set mixes measured-outside attempts with unverifiable ones
- **THEN** the shared reason starts blank rather than claiming something untrue of
  part of the set

#### Scenario: A denied set collects no position

- **WHEN** a manager denies a selected set of any size
- **THEN** no position request is made on their device and no decision stores
  manager coordinates

### Requirement: A refused set costs the action, not the selection

A refusal SHALL settle nothing and SHALL classify itself well enough for the
surface to recover without a blind retry. The surface SHALL re-read the day,
SHALL keep every selection that is still valid, SHALL drop only the rows that
changed, and SHALL name them, so the manager re-acts on the remainder in one
action rather than rebuilding the set.

The refusal SHALL NOT describe rows the caller is not entitled to read.

#### Scenario: A refusal keeps the surviving selection

- **WHEN** a set of eight is refused because one person retried mid-action
- **THEN** nothing is settled, the seven unaffected people remain selected, the
  one that changed is named and dropped, and one action settles the seven

#### Scenario: A refusal describes no unreadable row

- **WHEN** a hand-crafted set contains a row at an outlet the caller cannot read
- **THEN** the refusal states that the set was not permitted without disclosing
  anything about that row

### Requirement: Decisions from one action share a command identity

Every decision written by one action SHALL carry a shared command identity
recorded on the decision, so that history states that those people were settled
by one act rather than leaving it to be inferred from adjacent timestamps. That
identity SHALL correlate the decisions and SHALL NOT replace them: each person
SHALL retain their own immutable decision with its own actor, time, outcome,
reason where applicable, retry policy and approval evidence.

Decisions recorded before this capability existed SHALL carry no command
identity, rather than being given one retrospectively.

#### Scenario: One action, one identity, several decisions

- **WHEN** six people are approved in one action
- **THEN** six separate decisions are appended, each complete on its own, all six
  carrying the same command identity

#### Scenario: History is not rewritten

- **WHEN** decisions recorded before this change are read
- **THEN** they carry no command identity and are otherwise unchanged

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
holding a live **staff** assignment at an outlet in scope — an Employee or a
Biller — and SHALL NOT list a person merely because they hold a manager
assignment there: attendance is recorded for the people whose arrival the outlet
tracks, and a manager or an owner is not one of them. A person holding a staff
assignment alongside any other SHALL be listed, because their attendance is a
real thing.

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

**A row SHALL open onto its detail rather than render it.** Each listed row
SHALL show, without being opened, who it is about and what the day counts as;
the check-in time, the evidence, the approval and the row's actions SHALL be
reachable by opening it. A row **waiting for approval SHALL be open when the
view is opened**, since it is the row asking for a decision and approving is
what the view exists for. Whether a row is open SHALL be the reader's own state:
settling a day SHALL NOT close it. A row with no evidence, no approval and no
action SHALL offer nothing to open.

#### Scenario: A settled day is a headline until it is opened

- **WHEN** a Franchise Admin opens a business day holding an approved arrival
- **THEN** that row shows the person and the day's verdict, its evidence and
  approval are not shown, and opening the row shows them

#### Scenario: A waiting day is already open

- **WHEN** a Franchise Admin opens a business day holding an unapproved arrival
- **THEN** that row is open, with its evidence and its approve action shown
  without any further step

#### Scenario: Settling a day does not close it

- **WHEN** a Franchise Admin approves a waiting row
- **THEN** the row stays open and shows the approval that was just recorded

#### Scenario: A day with nothing recorded offers nothing to open

- **WHEN** a business day is read for a person carrying no row, on a day where
  no arrival may be entered
- **THEN** the row states what the day reads as and offers no way to open it

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

#### Scenario: A Biller with no Employee assignment is on the roll-call

- **WHEN** a person holds a live Biller assignment and no Employee assignment at
  the outlet, and that outlet's attendance day is opened
- **THEN** they are listed as staff, whether or not they carry a record on the
  day, and are not marked as off the staff list

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

Attendance SHALL be readable along two axes: **by day**, which is the roll-call
above for one business date across the outlets in scope, and **by staff**, which
is one person over **one calendar month**, defaulting to the current one, with a
summary of how many days were present, late, absent and waiting for approval.

**The outlet choice SHALL scope the surface rather than one axis.** It SHALL be
offered above the axis control, SHALL stay in the same place whichever axis is
read, and SHALL apply to both. This supersedes the earlier rule that the axis is
chosen before the outlet and that the outlet choice belongs to the by-outlet
axis alone.

**The period is a month and there SHALL be no second way to state it.** The
summary exists so somebody can work out pay by hand and pay is monthly; every
absence in the list is derived from the period's bounds, so an arbitrary span
would produce an arbitrary absence count indistinguishable from a meaningful
one. The control SHALL move a month at a time and SHALL NOT reach a month that
has not begun.

The by-staff read SHALL span every outlet the reader may see, and the set of
those outlets SHALL be resolved in the database from the reader's own live
assignments rather than from anything the request names. A Franchise Admin
holding one assignment therefore reads that outlet, a Franchise Admin holding
several reads exactly those, and a Super Admin reads all of them. A reader SHALL
NOT be able to obtain a person's days at an outlet they hold no live assignment
at, by the surface or by a hand-crafted request. **The outlet selection SHALL
NOT be named in that read**, so it can neither widen what comes back nor
contradict the policy that decides it.

**The outlet selection SHALL narrow who the by-staff axis offers**, to people
holding a staff assignment at a selected outlet, and SHALL NOT narrow anything
else about the axis. In particular a selected person's month SHALL continue to
be assembled against every outlet the reader may see, so a person who moved
between outlets inside the period reads as one continuous month rather than two
partial ones. Where the selection leaves nobody to offer, the axis SHALL say so
rather than present an empty control.

**A person the selection has narrowed away SHALL NOT remain the subject of the
read.** Where the person being read holds no staff assignment at any selected
outlet, the axis SHALL move to somebody it is offering, so the days on screen
always belong to a person the control names.

#### Scenario: The outlet selection narrows the person picker

- **WHEN** a reader who may see two outlets selects one of them and reads by
  staff
- **THEN** only people holding a staff assignment at the selected outlet are
  offered, and selecting the second outlet as well offers both outlets' people

#### Scenario: A narrowed month still spans the outlets the reader may see

- **WHEN** a reader selects one outlet and reads the month of a person who
  worked at two of the outlets that reader may see
- **THEN** every day of that month is listed once, including the days worked at
  the outlet that is not selected, and the read names no outlet

#### Scenario: The period cannot be stated as a loose range

- **WHEN** a reader inspects the period control on either range surface
- **THEN** it offers a month at a time and no way to enter arbitrary start and
  end dates

A person's days SHALL be counted once per business date in that summary, whatever
outlet each was worked at, because the summary exists to count days somebody
worked so their pay can be computed by hand.

A person who holds no staff assignment at any outlet the reader may see SHALL NOT
be offered here even if they carry recorded rows there. Such rows are read on the
business day they belong to, which is where anybody settling one needs them; a
range of days for somebody whose days are not tracked would be a pattern of
nothing.

A person reading their own attendance SHALL be offered the same month control,
and their own history SHALL continue to span every outlet they work or worked
at, each day naming its outlet. Each day SHALL open onto its detail on the same
terms as the roll-call's rows, since an employee sees exactly what their manager
sees.

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

### Requirement: Days waiting for approval are counted on the outlet each belongs to

A reader who may choose between outlets SHALL be able to see, without opening
each in turn, how many days are waiting for approval at each. A day nobody
settles is otherwise invisible until somebody queries their pay.

**That count SHALL be carried by the outlet selector itself**, on the same chip
that selects the outlet, so that noticing a backlog and reaching it are one
gesture and the row of outlets does not change shape with the state of the
database. There SHALL NOT be a second control listing the same outlets. Selecting
an outlet from it adds it to the selection like any other selection, and does not
displace the outlets already being read.

The counts SHALL cover exactly the outlets the reader may see, resolved by the
attendance policies rather than by the reader's role: a Franchise Admin holding
assignments at two outlets sees those two, and a Super Admin sees all of them. A
reader with one outlet has nothing to choose between and SHALL be shown no
selector and no count; the day's own badge and the earlier and later day marks
already state everything a per-outlet count could tell them.

An outlet holding nothing SHALL carry no count, so an absent count always means
the same thing.

This count is across every business day, and is therefore not the same as the
waiting count for the day on screen: an outlet may hold nothing today and a
week of unsettled days behind it.

#### Scenario: Each outlet chip carries its own backlog

- **WHEN** a reader who may see two outlets opens attendance and both hold
  waiting days
- **THEN** each outlet's chip in the selector carries its own count of unsettled
  days, and no separate list of outlets is shown

#### Scenario: Reaching a stranded outlet keeps the one in hand

- **WHEN** that reader selects an outlet carrying a count
- **THEN** the view covers that outlet as well as the ones already selected

#### Scenario: An outlet holding nothing carries no count

- **WHEN** one of the outlets a reader may see holds no unsettled days
- **THEN** its chip carries no count at all rather than a nought

#### Scenario: A manager sees only their own

- **WHEN** a Franchise Admin who may see one outlet opens attendance
- **THEN** no outlet selector is shown, and no other outlet's unsettled days
  are shown to them

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

### Requirement: An absent day states why it is absent

A day reading absent SHALL state its cause in plain language on every surface
that renders it — the manager's day, the person view and the employee's own
history — stating the same facts on each, because a verdict somebody may dispute
is not reviewable from the word alone.

The cause SHALL be addressed to whoever is reading it. Where the reader is the
person the day belongs to, it SHALL speak to them directly; where the reader is
the manager who made the decision, it SHALL name them as the actor in the second
person. Where the reader is neither, it SHALL use neither — a reader MUST NEVER
be told they failed to check in on a day that is not theirs, or that a decision
was theirs when it was not. Both SHALL be resolved from the reader's own
identity against the day's subject and the decision's actor, never from a
per-surface setting.

The cause SHALL be revealed when the day is expanded and SHALL NOT occupy the
collapsed headline, so a roll-call stays scannable. A day whose only content is
its cause SHALL therefore be expandable, which the two other derived
readings — not yet arrived, and working at another outlet — SHALL NOT be, having
nothing to state.

The cause SHALL be stated in as few words as carry the fact. It SHALL NOT name
the business date or the person, both of which the card's own heading already
gives, and SHALL NOT restate the verdict above it.

Where a manager's decision made the day absent, the cause SHALL name that
manager and present the reason they recorded. It SHALL distinguish a denied
check-in from a corrected outcome by stating what the day counted as before the
correction, rather than by wording alone, so the two are not two similar
sentences the reader has to weigh.

**The cause SHALL be the decision that made the day absent, not the most recent
decision on it.** A decision that only opens or closes the door to another
check-in records `absent` as its new status while deciding nothing about the
outcome, and SHALL NOT displace the denial or correction that did — a reader
asking why a day is absent must not be answered with the fact that a manager
kept it absent. Such adjustments SHALL remain visible in the day's history.

Where no attendance row exists at all, the cause SHALL name the arrival deadline
that was missed, rather than reporting that a deadline passed without saying
which. Where the person's outlets in the reader's scope set different deadlines,
it SHALL name the latest of them, being the deadline whose passing decided the
absence for that reader. Two readers of differing scope MAY therefore be shown
different times for one day, and each SHALL be the time that justified the
verdict they are looking at.

Where the row is absent and no manager decision accounts for it, the cause SHALL
say exactly that, and SHALL NOT distinguish a row carrying no decision from one
carrying only a migrated placeholder — they differ in where the row came from and
not at all in what the reader is being told.

The cause SHALL be derived from the stored row and the outlet's clock at read
time. Nothing SHALL be written to record it, and no fact SHALL be disclosed to
one reader that the other cannot see.

#### Scenario: A denied day names the manager and their reason

- **WHEN** a manager or the employee themselves expands a day whose check-in was
  denied
- **THEN** it states that the named manager denied the check-in, and shows the
  reason the manager recorded

#### Scenario: A corrected day says what it was before

- **WHEN** either reader expands a day an authorised manager corrected to absent
  from another outcome
- **THEN** it names the manager, states what the day counted as before the
  correction, and shows their recorded reason

#### Scenario: An absence no decision accounts for says so

- **WHEN** either reader expands an absent day carrying no manager decision, or
  only the placeholder a migration wrote for a day recorded before decisions
  were kept
- **THEN** both read the same sentence, stating that no manager decision on
  record explains it, and neither names an actor the row does not hold

#### Scenario: A deadline-derived absence names the deadline

- **WHEN** either reader expands a day with no attendance row whose arrival
  deadline has passed
- **THEN** it names the time that deadline fell at, and no outlet, arrival time or
  evidence is invented for it

#### Scenario: A person staffed at two outlets is judged by the later deadline

- **WHEN** the owner, who sees both outlets, reads an absent day for somebody
  assigned to outlets closing arrivals at 13:00 and 20:00
- **THEN** the cause names 20:00, the deadline whose passing decided the absence

#### Scenario: A narrower reader is shown the deadline that decided what they see

- **WHEN** an admin who may see only the 13:00 outlet reads that same day
- **THEN** the cause names 13:00, matching the scope the absent verdict itself was
  derived from, and no deadline is quoted from an outlet the reader cannot see

#### Scenario: Closing a retry does not become the reason

- **WHEN** a manager denies a check-in, leaves retry open, and later prevents
  another check-in on the same still-absent day
- **THEN** the cause still names the denial and its reason, and the retry being
  closed appears in the day's history rather than as the explanation

#### Scenario: The employee reads the same cause as their manager

- **WHEN** the same absent day is read from the manager's roll-call and from the
  employee's own history
- **THEN** both state the same cause, the employee's addressed to them and the
  manager's not, with no fact present in one and absent from the other

#### Scenario: A manager reads their own decision back

- **WHEN** the manager who denied or corrected a day expands it on the roll-call
- **THEN** the cause names them in the second person rather than repeating their
  own name at them

#### Scenario: A manager is never told they were the absent one

- **WHEN** a manager expands an absent day belonging to somebody else
- **THEN** nothing in the cause addresses the manager as the person who failed to
  check in

#### Scenario: A day with nothing to state stays a headline

- **WHEN** either reader looks at a day reading not yet arrived or working at
  another outlet
- **THEN** the verdict is on the face of the row and there is nothing to expand

### Requirement: The late tag reads before the verdict it qualifies

Late SHALL remain a tag and never a status: an approved late day is present and
late, and whether that costs half a day stays a manager's decision recorded in
the status.

Where a day is both settled and late, the tag SHALL be rendered **before** the
status it qualifies, on every surface that shows one — the roll-call, the
person's month, and the employee's own history — so that a reader scanning a
column of days meets the qualifier and the verdict in the order they are read.

#### Scenario: A late present day reads as late first

- **WHEN** any surface renders a day that is present and late
- **THEN** the late tag appears before the word Present, and both are still
  present with the tag still named to a screen reader
