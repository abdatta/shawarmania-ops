## ADDED Requirements

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
