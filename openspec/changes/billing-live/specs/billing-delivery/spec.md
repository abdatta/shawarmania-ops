## ADDED Requirements

### Requirement: Counter mutation acknowledgement is a durable local commit
The system SHALL write an immutable, versioned billing command envelope to the enrolled device's IndexedDB before it reports success or clears the operator's form, and SHALL NOT require a network response for that acknowledgement.

#### Scenario: Local commit succeeds while the backend is unreachable
- **WHEN** an eligible operator submits a valid counter mutation during an active grant and the backend request cannot complete
- **THEN** the system durably stores the envelope, clears the form only after that commit, marks the command pending, and displays the offline state

#### Scenario: Durable storage fails
- **WHEN** IndexedDB cannot durably commit a submitted command
- **THEN** the system does not report success, does not clear the form, and explains that the operation was not saved

### Requirement: Pending delivery survives session and application lifecycle
Pending and quarantined envelopes SHALL survive operator logout, daily cutoff, browser restart, and compatible application updates while the device remains registered. Old pending work MAY drain without opening a new counter session, but new billing after cutoff or reload SHALL require successful online authentication.

#### Scenario: Pending command survives logout and restart
- **WHEN** an accepted local command remains pending and the operator logs out or the browser restarts
- **THEN** the same device retains the command and later resumes delivery without recreating it or changing its UUID

#### Scenario: Cutoff passes with pending work
- **WHEN** the outlet cutoff expires while commands remain pending
- **THEN** the system may deliver those historical commands but refuses new billing until an eligible operator authenticates online for the new business day

### Requirement: One leader drains commands in dependency order
The system SHALL elect at most one active drain leader per local store, SHALL retry with bounded backoff, and SHALL deliver each command only after its local ancestors have reached an accepted terminal result. A blocked dependency chain SHALL NOT block unrelated commands.

#### Scenario: Order is created, revised, and paid while requests fail
- **WHEN** the local store contains dependent create, revise, and pay commands for one order
- **THEN** the drain submits them in dependency order and never submits payment against a server order that has not been created

#### Scenario: One order is quarantined
- **WHEN** a command in one order chain is permanently rejected
- **THEN** its descendants stop and become visibly blocked while unrelated order chains continue draining

### Requirement: Reachability is derived from real request evidence
The system SHALL distinguish missing-response transport failures from server authentication, authorization, validation, version, and idempotency responses. It SHALL use browser connectivity hints only to trigger attempts and not as proof that the backend is reachable.

#### Scenario: Wi-Fi exists but the backend cannot respond
- **WHEN** the browser reports online but billing requests return no HTTP response
- **THEN** the system shows the offline banner and retains commands for retry

#### Scenario: Server refuses a command
- **WHEN** the backend returns a structured authorization or validation refusal
- **THEN** the system records that server outcome and does not mislabel it as an offline failure

### Requirement: Delivery outcomes are explicit and idempotent
An accepted response or exact replay SHALL resolve one local command to the same server result. Retryable failures SHALL remain pending. Correctable permanent refusals SHALL be quarantined, and a correction SHALL use a new UUID linked to the rejected command. Discard SHALL retain actor, time, and reason as a tombstone.

#### Scenario: Response is lost after server commit
- **WHEN** the server commits a command but the response is lost and the same UUID and payload are retried
- **THEN** the exact replay returns the original result and the local command resolves without a duplicate bill or order mutation

#### Scenario: UUID is reused with different content
- **WHEN** a retry uses an existing command UUID with a different canonical payload
- **THEN** the system quarantines the attempt as an idempotency conflict and does not treat it as delivered

### Requirement: Revoked-device recovery is upload-only
Device revocation SHALL stop ordinary reads, grants, and queue delivery without deleting local envelopes. An authenticated FA or SA physically using that device SHALL be able to submit eligible pre-revocation envelopes through the recovery contract without restoring billing access.

#### Scenario: Admin recovers valid pending work
- **WHEN** an FA or SA authenticates on a revoked device and invokes recovery for a command created within its historical grant before revocation
- **THEN** the backend processes it idempotently, flags the recovery result, and leaves the device revoked

### Requirement: Delivery diagnostics exclude customer PII
Operational status and telemetry SHALL expose counts, age, command type, non-PII references, and result categories without logging customer phone numbers or command payloads.

#### Scenario: Admin inspects a delayed queue
- **WHEN** an admin views delivery diagnostics
- **THEN** the system shows actionable pending and quarantined metadata without customer phone numbers or full payload content

### Requirement: Finishing a device day requires a resolved online queue
The billing device SHALL offer an online finish-day action that refuses while any
command for the business date is pending, blocked, or quarantined. Success SHALL
end the active grant and create the server device-day seal/watermark used by the
business-day sign-off contract. Ordinary logout SHALL NOT create that seal.

#### Scenario: Queue is fully delivered
- **WHEN** the operator finishes billing online with no unresolved local command for the date
- **THEN** the grant ends, the server records a current device-day seal, and the counter accepts no more work under that grant

#### Scenario: Quarantined payment remains
- **WHEN** the operator attempts to finish while a command is quarantined
- **THEN** the action is refused and identifies the unresolved category without exposing customer PII

#### Scenario: Counter is offline at finish time
- **WHEN** the operator attempts to finish without an authoritative server response
- **THEN** the app keeps billing state intact and explains that online reconciliation is required before day sign-off
