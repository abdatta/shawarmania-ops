## ADDED Requirements

### Requirement: A new settled bill with a number sends automatically

The system SHALL enqueue one receipt SMS when a newly settled bill with a valid
Indian mobile reaches the server while delivery is enabled. Providing that number
SHALL be receipt-message opt-in with no separate consent step. The SMS SHALL
contain the bill's earned points, frozen outlet balance after the bill and receipt
link, using the approved template and no shortener. Zero-earned bills SHALL send
zero and preserve the existing balance.

#### Scenario: Customer pays
- **WHEN** a new settled bill with a valid number commits
- **THEN** it is queued after its points exist without waiting on Prepared

#### Scenario: Number skipped
- **WHEN** a bill has no valid number
- **THEN** no delivery is created and billing succeeds

### Requirement: Offline sync and replay do not duplicate submission

SMS SHALL be submitted asynchronously after server commit. Billing SHALL NOT
wait for MSG91. A bill UUID SHALL have at most one automatic provider submission,
including under replay, worker concurrency and a lost response. An uncertain
submission SHALL be visible and SHALL NOT be retried automatically.

#### Scenario: Offline bill arrives twice
- **WHEN** an eligible bill syncs and its command is replayed
- **THEN** one job exists and only one worker may submit it

#### Scenario: Lost provider response
- **WHEN** acceptance cannot be established
- **THEN** the job is uncertain and no second automatic submission occurs

### Requirement: Activation excludes history and demo

Delivery SHALL start disabled. Enabling SHALL send nothing for bills paid before
activation. Demo SHALL make no provider request or delivery write. Cancelled bills
and revoked receipt links SHALL NOT be submitted.

#### Scenario: Activation
- **WHEN** delivery is enabled in an outlet with history
- **THEN** existing and pre-activation offline bills send nothing

#### Scenario: Demo sale
- **WHEN** a demo customer pays
- **THEN** no real SMS sends

### Requirement: Status is truthful, authenticated and isolated

Owner and same-outlet managers SHALL see queued, sending, submitted, delivered,
failed, uncertain or skipped state. API success SHALL NOT claim handset delivery.
Authenticated callbacks SHALL be idempotent and work before the send response is
recorded. Clients SHALL NOT claim/submit/manufacture reports or read another
outlet's deliveries. Diagnostics SHALL NOT contain phones or receipt tokens.

#### Scenario: Failure
- **WHEN** MSG91 rejects a send or reports operator failure
- **THEN** the manager sees a fixed explanation and can share manually on WhatsApp

#### Scenario: Report first
- **WHEN** a delivered report precedes the worker's send response
- **THEN** the recorded state remains delivered

#### Scenario: Other outlet
- **WHEN** a manager hand-crafts a request for another outlet's delivery
- **THEN** no row is returned and no write is allowed
