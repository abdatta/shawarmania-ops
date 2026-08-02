## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: A manager can deny one pending attendance attempt

A Super Admin, or a Franchise Admin holding a live assignment at the pending attempt's outlet, SHALL be able to deny that attempt one person at a time. A
denial SHALL mark the canonical day absent, record the acting manager and
database time, require a non-blank editable reason, and record whether the
manager prevented another employee check-in that business day.

The denial form SHALL contain only the required reason and one
`Prevent another check-in today` checkbox. The checkbox SHALL always be
unchecked when the form opens. A measured outside attempt SHALL prefill the
reason as `Check-in was outside the outlet geofence`; an unverifiable attempt
SHALL prefill `Check-in location could not be verified`. Prefill SHALL remain
editable and SHALL NOT replace database enforcement of a non-blank reason.

Denial SHALL NOT read or store the manager's position, because it does not
vouch for presence.

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

An authorised manager SHALL be able to correct the current outcome or retry
permission without deleting or editing a prior attempt, approval, denial or
correction. Every correction SHALL append the acting manager, database time,
previous outcome, new outcome and a required non-blank reason.

Ordinary waiting rows SHALL show Approve and Deny. Settled rows SHALL not carry
a permanent row of correction buttons; one unobtrusive `Correct attendance`
entry point in expanded details SHALL show only actions relevant to the current
state: mark absent, mark present, allow another check-in, or mark absent and
allow another check-in.

A correction to present SHALL use the latest recorded employee attempt and
SHALL capture the manager's position under the same on-site, same-business-day
reason rule as approval. It SHALL NOT invent a later employee position or
arrival time. A correction to absent or retry permission SHALL not read manager
position.

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
