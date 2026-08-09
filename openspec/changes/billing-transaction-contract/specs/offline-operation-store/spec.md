## ADDED Requirements

### Requirement: Local commitment precedes counter acknowledgement

Every accepted counter operation SHALL be committed atomically to IndexedDB with
a client UUID, tablet, shift, type, creation time, payload version and canonical
payload hash before the UI reports success or clears its form. No network request
SHALL be awaited for that acknowledgement.

#### Scenario: Local commit succeeds while the backend is unreachable
- **WHEN** the local transaction commits and the network request cannot complete
- **THEN** the UI may acknowledge the operation and the queue retains it for retry

#### Scenario: Local commit fails
- **WHEN** IndexedDB refuses the transaction or storage is unavailable
- **THEN** the UI does not report success and preserves every input for retry

### Requirement: Accepted operations survive human and application lifecycle changes

Pending operations SHALL survive the shift ending, cutover, page reload, browser
restart and app-schema upgrade, until acknowledged by the server or explicitly
discarded through an authorised, attributed flow.

#### Scenario: The shift ends with pending work
- **WHEN** a shift ends while operations remain unsent
- **THEN** the queue retains their original shift and they never become the next operator's authorship

#### Scenario: Browser restarts
- **WHEN** the PWA reopens after process termination
- **THEN** every committed pending operation is still present and may drain once connectivity and tablet authorisation return

### Requirement: One foreground leader drains retryable operations

At most one page for the installed origin SHALL actively drain the queue. Drain
state SHALL be derived from actual responses; connectivity hints MAY wake the
drain but SHALL NOT classify success or failure.

#### Scenario: Two tabs are open
- **WHEN** both pages observe pending operations
- **THEN** one holds drain leadership while the other observes state without submitting duplicates

#### Scenario: Online hint is wrong
- **WHEN** the browser reports online but the request receives no backend response
- **THEN** the operation remains retryable and is not marked delivered

### Requirement: Queue entries are never silently lost, reinterpreted, or stripped of unknown values

The store SHALL distinguish held, pending, retrying, needs-attention and
acknowledged states. A payload version or hash SHALL NOT be changed in place
after acceptance, and payload contents including phone numbers SHALL NOT be
written to application logs.

An argument whose value is unknown SHALL be transmitted explicitly rather than
omitted, so that a serialiser cannot drop it and leave the command unmatched at
the database. Every command argument SHALL be present in the sent payload.

#### Scenario: Permanent refusal
- **WHEN** the server classifies an operation as permanently invalid
- **THEN** it moves to needs-attention with a safe reason category and remains available for authorised correction or discard

#### Scenario: Same identity has different content
- **WHEN** a retry response reports the client UUID was previously used for a different payload hash
- **THEN** the entry moves to needs-attention as an identity conflict rather than being marked successful

#### Scenario: An optional value is unknown
- **WHEN** an operation is created with an optional value the operator did not supply
- **THEN** the sent payload still carries that argument explicitly, and the database function matches and executes
