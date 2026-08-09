## ADDED Requirements

### Requirement: Every billing mutation is one versioned atomic command

Clients SHALL mutate orders and bills only through typed, versioned RPC commands.
Each accepted command SHALL commit its receipt, parent, children, totals, state
transition, number allocation and attribution in one transaction, or commit none
of them. Direct client insert, update and delete on money tables SHALL be refused.

#### Scenario: A bill line fails validation
- **WHEN** one line in a pay-now command is invalid
- **THEN** no bill, line, receipt or consumed bill number remains

#### Scenario: Client attempts a direct insert
- **WHEN** a valid device session inserts a bill through the data API
- **THEN** the database refuses the write

### Requirement: Command replay is exact and payload mismatch is a conflict

Every command SHALL carry a client UUID, type, schema version and canonical
payload hash. Replaying the identical tuple SHALL return its original result
without repeating any effect. Reusing the UUID with a different type, version or
hash SHALL return an identity conflict and SHALL NOT be treated as success.

#### Scenario: Exact pay-now replay
- **WHEN** the same accepted pay-now envelope is submitted twice
- **THEN** both responses identify the same bill and number, and exactly one bill exists

#### Scenario: UUID is reused with another total
- **WHEN** a prior command UUID is submitted with a different payload hash
- **THEN** the server returns an identity conflict and changes no money row

### Requirement: Every command argument is transmitted explicitly

A command payload SHALL carry every argument its function declares, sending an
explicit null where the value is unknown. A payload that omits a declared key
SHALL be rejected as malformed rather than silently matching no function.

#### Scenario: An optional customer detail is unknown
- **WHEN** a pay-now command is sent for a sale with no customer name or phone
- **THEN** the payload still carries both arguments explicitly and the command executes

#### Scenario: A key is missing
- **WHEN** a command payload omits a declared argument
- **THEN** it is refused as malformed with a category the client can act on, rather than reported as an unknown command

### Requirement: Delayed commands use historical shift validity

A delayed command SHALL remain eligible when its immutable client creation time
falls inside its referenced tablet and shift, and before that tablet was removed,
even if it arrives after cutoff or after a later account change. Ordinary
submission by a removed tablet SHALL remain blocked.

#### Scenario: Operator is deactivated after creation
- **WHEN** a command created during their valid shift arrives after the account was deactivated
- **THEN** it may be accepted with its original historical attribution

#### Scenario: Command claims a time outside its shift
- **WHEN** its creation time precedes the shift opening or reaches its expiry
- **THEN** the command is refused permanently

### Requirement: Command responses classify retry safely

Responses SHALL distinguish accepted, exact replay, order-not-open, retryable
transport or server failure, current authorisation refusal, removed tablet,
unsupported schema, malformed payload or arithmetic, and identity conflict. A
generic HTTP status SHALL NOT by itself convert a duplicate or a conflict into
success.

#### Scenario: Backend temporarily fails
- **WHEN** no authoritative command result is obtained
- **THEN** the client may retain the exact envelope as retryable

#### Scenario: Unsupported payload version
- **WHEN** the server cannot safely interpret the version
- **THEN** it returns a permanent unsupported-schema classification with no mutation

### Requirement: Command receipts are compact and carry no customer payload

The idempotency receipt SHALL retain identifiers, canonical hash, type and
version, times, result category and the entity references needed for replay. It
SHALL NOT store a customer name or phone, or line payloads, a second time.

#### Scenario: Receipt is inspected
- **WHEN** an authorised diagnostic reads a command receipt
- **THEN** exact replay can be decided without exposing customer or line contents

### Requirement: A tablet's end-of-day confirmation is explicit and invalidatable

A tablet SHALL record an end-of-day confirmation for an outlet and business date
online, and only after its shift has ended and it reports nothing unsent for that
date. The confirmation SHALL record a server command watermark and SHALL become
invalid if a later command for that tablet and date is accepted.

#### Scenario: The tablet still has unsent work
- **WHEN** a tablet attempts to confirm a date while an operation is unsent or needs attention
- **THEN** the confirmation is refused and the unresolved category remains a close blocker

#### Scenario: A delayed command follows a confirmation
- **WHEN** the server accepts a valid historical command for that tablet and date afterwards
- **THEN** the confirmation is invalidated and the date cannot be signed off until the tablet confirms again

### Requirement: Settlement readiness is checked at the database boundary

The server SHALL expose one outlet and date readiness answer combining terminal
order state, ended shifts, and a current end-of-day confirmation from every
tablet that worked the date. A day-sign-off mutation SHALL lock and recheck those
facts transactionally rather than trusting client counts.

#### Scenario: Hand-crafted sign-off bypass
- **WHEN** a caller attempts to sign off a date whose server readiness has any blocker
- **THEN** the database refuses the close whatever the UI displayed
