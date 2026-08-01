## ADDED Requirements

### Requirement: Every billing mutation is one versioned atomic command

Clients SHALL mutate orders and bills only through typed, versioned RPC commands.
Each accepted command SHALL commit its receipt, parent, children, totals, state
transition, number allocation, and event in one transaction or commit none.
Direct client insert, update, and delete on money tables SHALL be refused.

#### Scenario: Bill line validation fails
- **WHEN** one line in a pay-now command is invalid
- **THEN** no bill, line, receipt, event, or consumed bill number remains

#### Scenario: Client attempts direct insert
- **WHEN** a valid machine token inserts a bill through the data API
- **THEN** the database refuses the write

### Requirement: Command replay is exact and payload mismatch is a conflict

Every command SHALL carry a client UUID, type, schema version, and canonical
payload hash. Replaying the identical tuple SHALL return its original result
without repeating effects. Reusing the UUID with any different type, version,
or hash SHALL return an idempotency conflict and SHALL NOT be treated as success.

#### Scenario: Exact pay-now replay
- **WHEN** the same accepted pay-now envelope is submitted twice
- **THEN** both responses identify the same bill/number and exactly one bill exists

#### Scenario: UUID is reused with another total
- **WHEN** a prior command UUID is submitted with a different payload hash
- **THEN** the server returns idempotency conflict and changes no money row

### Requirement: Delayed commands use historical grant validity

A delayed command SHALL remain eligible when its immutable client creation time
falls within its matching device/operator grant and before device revocation,
even if received after cutoff or later role/account change. The result SHALL be
flagged late where applicable. Ordinary submission by a revoked device SHALL
remain blocked; recovery requires current FA/SA authentication.

#### Scenario: Biller is demoted after creation
- **WHEN** a command created during their valid grant arrives after the Biller assignment ended
- **THEN** it may be accepted with historical attribution and a visible late flag

#### Scenario: Command claims time outside the grant
- **WHEN** its creation time precedes grant opening or reaches/exceeds grant expiry
- **THEN** the command is refused permanently

### Requirement: Command responses classify retry and recovery safely

Responses SHALL distinguish accepted, exact replay, optimistic conflict,
retryable unavailable/server failure, current authorization refusal,
recovery-required revocation, unsupported schema, malformed arithmetic/scope,
and idempotency conflict. A generic HTTP status SHALL NOT by itself convert a
duplicate or conflict into success.

#### Scenario: Backend temporarily fails
- **WHEN** no authoritative command result is obtained
- **THEN** the client can retain the exact envelope as retryable

#### Scenario: Unsupported payload version
- **WHEN** the server cannot safely interpret the version
- **THEN** it returns permanent unsupported-schema classification without mutation

### Requirement: Command receipts are compact and contain no customer payload

The idempotency receipt SHALL retain identifiers, canonical hash, type/version,
times, result category, and resulting entity references needed for replay. It
SHALL NOT store customer name/phone or line payloads a second time.

#### Scenario: Receipt is inspected
- **WHEN** an authorized diagnostic reads a command receipt
- **THEN** exact replay can be decided without exposing customer or line contents

### Requirement: Device-day seals make local settlement readiness explicit

A device SHALL create a business-day seal online only after ending its grant and
reporting no pending, blocked, or quarantined local command for that date. The
seal SHALL record a server command watermark and SHALL become invalid if a later
command for that device/date is accepted. Readiness SHALL require a valid seal
from every device that held a grant or command for the date and no remaining live grant.

#### Scenario: Device queue is not resolved
- **WHEN** a device attempts to seal a date with a pending or quarantined command
- **THEN** the seal is refused and the unresolved category remains a close blocker

#### Scenario: Delayed command follows a seal
- **WHEN** the server accepts a valid historical command for a device/date after its prior seal
- **THEN** that seal is invalidated and the date cannot be signed off until the device reconciles and seals again

### Requirement: Settlement readiness is checked at the database boundary

The server SHALL expose an outlet/date readiness check combining terminal order
state, expired or ended grants, and valid device-day seals. A future day-sign-off
mutation SHALL lock and recheck these facts transactionally rather than trusting
client counts.

#### Scenario: Hand-crafted sign-off bypass is attempted
- **WHEN** a caller attempts to sign off a date whose server readiness has any blocker
- **THEN** the database refuses the close regardless of what the UI displayed
