# Delta: attendance-and-location

## ADDED Requirements

### Requirement: A manager decides an explicitly selected set in one atomic command

A Super Admin, or a Franchise Admin holding a live assignment at each selected
row's own outlet, SHALL be able to approve or deny an explicitly selected set of
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

Nothing SHALL be selected when selection begins. Only rows currently waiting for
a decision SHALL be selectable, including a waiting row belonging to somebody who
holds no staff assignment at the outlet. No count, badge or outlet chip SHALL
double as a selection control.

Selecting a row and opening it SHALL be different acts, so that reading somebody's
evidence neither selects them nor disturbs the set already built.

A selection SHALL be cleared by a successful action, by leaving the day, by
changing the outlets in scope, and by cancelling. A control that clears the whole
selection at once SHALL be permitted, because it only ever removes people from
an action.

#### Scenario: Nothing is selected when selection begins

- **WHEN** a manager enters selection mode on a day holding several waiting rows
- **THEN** no row is selected and the action bar states a count of zero

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

- **WHEN** a manager opens a row to read its evidence while a selection is being
  built
- **THEN** the row opens, its selected state does not change, and the rest of the
  selection is untouched

#### Scenario: A successful action clears the selection

- **WHEN** a set is approved or denied successfully
- **THEN** the selection is emptied, so the next action begins from nothing

### Requirement: A set of people is confirmed by name before anything is written

Where more than one person is being decided, one confirmation SHALL name every
selected person, the outlet each belongs to, and their business date where the
set spans dates, and SHALL state what is about to happen to them. Nothing SHALL
be written until that confirmation is accepted.

The confirmation SHALL be the final step. Where the rule requires a reason, the
reason SHALL be collected first and the confirmation SHALL follow it, so the
people are named in the light of the explanation just written. A decision about a
single person SHALL NOT be confirmed this way, because its own row is the thing
being looked at.

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

#### Scenario: One person is not confirmed twice

- **WHEN** a manager approves a single waiting row from its own row action
- **THEN** it behaves exactly as it does today, with no extra confirmation step

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

## MODIFIED Requirements

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

### Requirement: A manager can deny one pending attendance attempt

A Super Admin, or a Franchise Admin holding a live assignment at the pending
attempt's outlet, SHALL be able to deny that attempt. A
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
