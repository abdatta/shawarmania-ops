## ADDED Requirements

### Requirement: Local commitment precedes counter acknowledgement

Every accepted counter operation SHALL be committed atomically to IndexedDB
with a client UUID, device, grant, type, creation time, payload version, and
canonical payload hash before the UI reports success or clears its form. No
network request SHALL be awaited for that acknowledgement.

#### Scenario: Local commit succeeds while the backend is unreachable
- **WHEN** the local transaction commits and the network request cannot complete
- **THEN** the UI may acknowledge the operation and the queue retains it for retry

#### Scenario: Local commit fails
- **WHEN** IndexedDB refuses the transaction or storage is unavailable
- **THEN** the UI does not report success and preserves every input for retry

### Requirement: Accepted operations survive human and application lifecycle changes

Pending operations SHALL survive operator logout, cutover, page reload, browser
restart, and app-schema upgrade until acknowledged by the server or explicitly
discarded through an authorized audited flow.

#### Scenario: Operator signs out with pending work
- **WHEN** a billing grant closes while operations remain pending
- **THEN** the queue retains their original grant and does not become the next operator's authorship

#### Scenario: Browser restarts
- **WHEN** the PWA reopens after process termination
- **THEN** every committed pending operation is still present and may drain after connectivity and machine authorization return

### Requirement: One foreground leader drains retryable operations

At most one page for the installed origin SHALL actively drain the queue. Drain
state SHALL be derived from actual responses; connectivity hints MAY wake the
drain but SHALL NOT classify success or failure.

#### Scenario: Two tabs are open
- **WHEN** both pages observe pending operations
- **THEN** one holds the drain leadership while the other observes state without submitting duplicates

#### Scenario: Online hint is wrong
- **WHEN** the browser reports online but the request receives no backend response
- **THEN** the operation remains retryable and is not marked delivered

### Requirement: Queue entries are never silently lost or reinterpreted

The store SHALL distinguish held, pending, retrying, blocked/recovery-required,
quarantined, and acknowledged states. A payload version or hash SHALL NOT be
changed in place after acceptance, and payload contents including phone numbers
SHALL NOT be written to application logs.

#### Scenario: Permanent validation refusal
- **WHEN** the server classifies an operation as permanently invalid
- **THEN** it moves to quarantine with the safe reason category and remains available for authorized correction or discard

#### Scenario: Same identity has different content
- **WHEN** a retry response reports the client UUID was previously used for a different payload hash
- **THEN** the entry is quarantined as an idempotency conflict rather than marked successful
