## ADDED Requirements

### Requirement: Counter acknowledgement is a durable local commit

The system SHALL write an immutable, versioned billing command envelope to the
tablet's IndexedDB before it reports success or clears the operator's form, and
SHALL NOT require a network response for that acknowledgement. A direct-payment envelope
SHALL remain ineligible for delivery during the existing six-second Undo window;
Undo SHALL remove it while still unsent and restore the complete composer.

#### Scenario: Local commit succeeds while the backend is unreachable
- **WHEN** an operator submits a valid counter mutation during a live shift and the backend request cannot complete
- **THEN** the system durably stores the envelope, clears the form only after that commit, marks the command not sent yet, and shows the offline state

#### Scenario: Durable storage fails
- **WHEN** IndexedDB cannot durably commit a submitted command
- **THEN** the system does not report success, does not clear the form, and explains that the operation was not saved

#### Scenario: Mark Paid is undone before delivery
- **WHEN** the operator uses Undo during the guaranteed window
- **THEN** no request has begun, the envelope is removed, and its lines, customer form and payment method return to the composer

### Requirement: Unsent work survives session and application lifecycle

Unsent and needs-attention envelopes SHALL survive the shift ending, cutover,
browser restart and compatible application updates while the tablet remains set
up. Old unsent work MAY drain without a new shift, but new billing after cutover
or a reload SHALL require a fresh approved shift.

#### Scenario: Unsent command survives the shift ending and a restart
- **WHEN** an accepted local command is still unsent and the shift ends or the browser restarts
- **THEN** the same tablet retains the command and later resumes delivery without recreating it or changing its UUID

#### Scenario: Cutover passes with unsent work
- **WHEN** the outlet cutover arrives while commands are unsent
- **THEN** the system may deliver those historical commands but refuses new billing until a fresh shift request is approved

### Requirement: One leader drains commands in dependency order

The system SHALL elect at most one active drain leader per local store, SHALL
retry with bounded backoff, and SHALL deliver each command only after its local
ancestors have reached an accepted result. A blocked chain SHALL NOT block
unrelated commands.

#### Scenario: An order is created, revised and paid while requests fail
- **WHEN** the local store holds dependent create, revise and pay commands for one order
- **THEN** the drain submits them in dependency order and never submits a payment against an order the server has not been told about

#### Scenario: One order chain needs attention
- **WHEN** a command in one order's chain is permanently refused
- **THEN** its descendants stop and are visibly blocked while unrelated chains keep draining

### Requirement: Reachability is derived from real request evidence

The system SHALL distinguish a missing response from a server authentication,
authorisation, validation or identity response. It SHALL use browser connectivity
hints only to trigger attempts, never as proof the backend is reachable.

#### Scenario: Wi-Fi exists but the backend cannot respond
- **WHEN** the browser reports online but billing requests return no HTTP response
- **THEN** the system shows the offline banner and retains commands for retry

#### Scenario: The server refuses a command
- **WHEN** the backend returns a structured authorisation or validation refusal
- **THEN** the system records that server outcome and does not mislabel it as an offline failure

### Requirement: Delivery outcomes are explicit and idempotent

An accepted response or an exact replay SHALL resolve one local command to the
same server result. Retryable failures SHALL stay unsent. A correctable permanent
refusal SHALL move to needs attention, and a correction SHALL use a new UUID
linked to the refused command. A discard SHALL retain actor, time and a non-blank
reason. Correction and discard SHALL be available only on the originating tablet
to an operator holding its live shift, and both SHALL retain the refused trace.

#### Scenario: The response is lost after the server commits
- **WHEN** the server commits a command, the response is lost, and the same UUID and payload are retried
- **THEN** the exact replay returns the original result and the local command resolves with no duplicate bill

#### Scenario: A UUID is reused with different content
- **WHEN** a retry uses an existing command UUID with a different canonical payload
- **THEN** the system moves it to needs attention as an identity conflict and does not treat it as delivered

### Requirement: A removed tablet stops delivering and keeps its evidence

Removing a tablet SHALL stop ordinary reads, shifts and queue delivery without
deleting local envelopes. There SHALL be no privileged upload path from a removed
tablet; work left unsent on one is a recorded operational limitation, and the
Tablets surface SHALL warn before removing a tablet reporting unsent work.

#### Scenario: A removed tablet attempts to drain
- **WHEN** a removed tablet's leader attempts delivery
- **THEN** every request is refused at the database boundary and the envelopes remain on the device

### Requirement: Delivery diagnostics exclude customer details

Operational status and telemetry SHALL expose counts, age, command type,
non-identifying references and result categories, without logging customer phone
numbers or command payloads. Manager diagnostics SHALL be read-only and SHALL
offer no correction or discard action.

#### Scenario: A manager inspects a delayed queue
- **WHEN** a manager views delivery diagnostics
- **THEN** they see actionable unsent and needs-attention metadata with no customer phone numbers and no payload content

### Requirement: Finishing the day requires a resolved online queue

The tablet SHALL offer an online finish-day action that refuses while any command
for the business date is unsent, blocked or needing attention. Success SHALL end
the shift and create the server end-of-day confirmation used by business-day
sign-off. An ordinary shift ending SHALL NOT create that confirmation.

#### Scenario: The queue is fully delivered
- **WHEN** the operator finishes billing online with nothing unresolved for the date
- **THEN** the shift ends, the server records a current end-of-day confirmation, and the counter accepts no more work under it

#### Scenario: A command still needs attention
- **WHEN** the operator attempts to finish while a command needs attention
- **THEN** the action is refused and names the unresolved category without exposing customer details

#### Scenario: The counter is offline at finishing time
- **WHEN** the operator attempts to finish with no authoritative server response
- **THEN** billing state stays intact and the app explains that the queue must reach the server before the day can be signed off
