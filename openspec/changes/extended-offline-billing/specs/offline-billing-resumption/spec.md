## ADDED Requirements

### Requirement: A complete resume record can reopen the counter after a cold start

After a successful online counter load the tablet SHALL persist, as one unit,
the facts it would otherwise ask the server for at startup: its own tablet
identity, label and outlet; the live shift's identity, operator name, opened
time, business date and expiry; the outlet cutover; the menu it is selling from;
the outlet pipeline and this shift's bills as the server last returned them; the
exact-phone customer results this tablet resolved; the instant of that successful
read with the server time observed at it and the device clock beside it; and a
schema version.

A resume record SHALL become readable only once every part of it has committed.
A cold start with no backend response SHALL use the newest complete record whose
schema this build supports and whose tablet is this installation, and no other.

#### Scenario: The tablet is reloaded during an outage

- **WHEN** a set-up tablet holding an approved shift is closed, updated or reloaded and no backend response arrives
- **THEN** the same counter reopens from its newest complete resume record, marked offline with the time of its last successful read

#### Scenario: The record is incomplete or too new to read

- **WHEN** no complete record exists for this tablet, or its schema is unsupported by this build
- **THEN** the tablet opens no new billing work, retains every envelope and resume record unchanged, and shows unsent and needs-attention status with the path back online

#### Scenario: The record belongs to another tablet

- **WHEN** a resume record names a tablet other than this installation
- **THEN** it SHALL NOT open a counter, whatever else it contains

### Requirement: Resuming offline never creates or extends authority

The counter SHALL open offline only inside the bounds of a shift already
approved online by its named operator. It SHALL stop accepting new commands at
the earlier of that shift's stored expiry and the outlet cutover, and SHALL
require the backend and the operator's own phone before any further shift.

Commands created offline SHALL carry the real tablet identity, the real shift
identity and their own immutable creation time, and the server SHALL remain the
only authority on whether each is accepted.

#### Scenario: Expiry passes during an outage

- **WHEN** the stored shift expiry or the outlet cutover is reached while the backend is still unreachable
- **THEN** new commands stop, existing work is retained with its status visible, and the tablet asks for the backend and the operator's phone rather than continuing

#### Scenario: A tampered record cannot buy authority

- **WHEN** a resume record is altered on the device to claim a longer shift, and its commands later reach the server
- **THEN** the server validates the real shift and refuses whatever falls outside it, exactly as it refuses any other delayed command

### Requirement: Remembered data is labelled with the read it came from

Every surface reading persisted server data SHALL show that the tablet is
offline and the time of its last successful read, and SHALL NOT present a
remembered menu, pipeline, bill or customer result as current server truth. The
outlet pipeline SHALL be presented as of that read, because an offline tablet
cannot learn of another tablet's work or of a manager clearing a stranded order.

The tablet SHALL show the last observed server time beside its own clock when
the two materially disagree, and SHALL warn rather than correcting either.

#### Scenario: The counter is read after resuming

- **WHEN** an operator uses the menu, the pipeline and this shift's bills after a cold start
- **THEN** all three are usable, all three state the read they came from, and a persistent offline line carries that time

#### Scenario: A manager cleared an order during the outage

- **WHEN** a manager cancels a stranded open order while the tablet is offline, and the tablet later acts on it
- **THEN** the command is refused as not open, the refusal names that order, and the rail corrects itself at the next successful read

### Requirement: Every counter command survives the cold start

Create, revise, mark prepared, reprepare, pay, take a payment back, cancel after
payment, correct a tender, cancel, and record an expense SHALL each be available
after an offline cold start, SHALL be composed from the resume record overlaid
with this tablet's own durable envelopes, and SHALL follow the existing
dependency, integer-paise and locally-refused-before-minting rules unchanged.

No bill number SHALL be allocated locally. An unsent bill SHALL carry its short
local reference and the words not sent yet, and no surface SHALL call it
provisional.

#### Scenario: An order is prepared, paid and corrected after a restart

- **WHEN** the tablet resumes offline, marks one of its open orders prepared, accepts payment and then corrects the tender inside the edit window
- **THEN** each is a separate immutable envelope chained in order, the bill reads not sent yet with its local reference, and the bill number is deferred to server acceptance

#### Scenario: A second restart mid-outage

- **WHEN** the tablet is closed and reopened again with work already captured offline
- **THEN** every envelope, dependency and local resolution is intact and the counter reopens on the same shift

### Requirement: Exact-phone reuse is the only offline customer identity

The tablet MAY reuse a customer result only for the exact normalized full phone
it resolved online, SHALL label it as remembered, and SHALL carry the same
replacement warning. It SHALL NOT offer directory browse, prefix search or
another customer's remembered result, and an unrecognised number SHALL remain
unresolved until sync.

#### Scenario: A known phone is entered offline

- **WHEN** the operator enters the exact full phone of a customer this tablet resolved earlier in the shift
- **THEN** the form may be autofilled, labelled as remembered, with the ordinary replacement warning

#### Scenario: A new phone is entered offline

- **WHEN** the phone has no exact remembered result
- **THEN** the optional form snapshot is accepted and the surface explains that customer identity resolves on sync

### Requirement: The day cannot be finished offline

Finish Day SHALL require authoritative server state, so an offline attempt SHALL
open the readiness sheet, state that the day cannot be finished without the
backend, and name what is waiting. The tablet SHALL NOT record, imply or
substitute for its end-of-day confirmation offline.

#### Scenario: Finish Day is attempted during an outage

- **WHEN** an operator chooses Finish day with no backend reachable
- **THEN** the sheet explains that server state is unavailable, lists the local work outstanding, and offers no completion

#### Scenario: Readiness keeps naming the tablet

- **WHEN** the business date is evaluated for readiness while this tablet has offline work and no confirmation
- **THEN** the tablet is reported as outstanding until it reconnects, drains and confirms online

### Requirement: Reconnect re-resolves before it drains, and refreshes last

On restored backend reachability the tablet SHALL first re-resolve its own
status and shift, SHALL stop ordinary delivery and new work if it learns it was
removed while retaining every envelope on the device, SHALL otherwise drain in
dependency order so each command resolves exactly once, and SHALL only then
replace remembered projections with authoritative reads.

#### Scenario: Twenty commands drain after an extended outage

- **WHEN** the tablet reconnects holding twenty valid pending commands across the order and payment lifecycle, one of which lost its first response
- **THEN** every effect lands exactly once, the replay resolves to its original result, refusals arrive as refusals with their ancestry, and the refreshed reads replace what was remembered

#### Scenario: Reconnect reveals the tablet was removed

- **WHEN** the first successful response after the outage reports the tablet removed
- **THEN** ordinary delivery and new work stop, every envelope stays on the device, and the surface says plainly that this tablet no longer serves the counter
