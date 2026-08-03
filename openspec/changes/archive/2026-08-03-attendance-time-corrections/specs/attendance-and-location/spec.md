## MODIFIED Requirements

### Requirement: Manager corrections are append-only and unobtrusive

An authorised manager SHALL be able to correct the current outcome, retry
permission, or effective check-in time without deleting or editing a prior
attempt, approval, denial, or correction. Every correction SHALL append the
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
