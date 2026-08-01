## ADDED Requirements

### Requirement: One outlet can have several independently enrolled devices
An FA for an outlet or an SA SHALL be able to enrol, name, inspect, and revoke several billing devices for that outlet. Every device SHALL have its own machine identity, remain bound to exactly one outlet, and be revocable without changing any other device or human assignment.

#### Scenario: Second device is enrolled
- **WHEN** an authorized admin enrols another physical device for an outlet
- **THEN** both devices retain distinct identities and may obtain independent daily operator grants for that same outlet

#### Scenario: One device is revoked
- **WHEN** an authorized admin revokes one of two devices
- **THEN** the revoked device loses server access immediately while the other device continues operating

### Requirement: Device health is scoped and excludes customer PII
The management surface SHALL show per-device status, last contact, grant summary, and reported pending/quarantined counts and age. FA access SHALL be limited to assigned outlets, SA MAY read across outlets, and health data SHALL contain no command payload or customer phone.

#### Scenario: FA opens device management
- **WHEN** an FA views devices for their outlet
- **THEN** they see each same-outlet device's labelled, timestamped health and no device from another outlet

### Requirement: Concurrent delivery is coordinated only by server contracts
Independent device queues SHALL be able to submit commands concurrently without client-to-client coordination. Command UUID/hash idempotency, optimistic versions, outlet RLS, and transactional bill numbering SHALL prevent duplicate effects, silent merges, and cross-outlet access.

#### Scenario: Two devices pay at the same time
- **WHEN** two same-outlet devices concurrently submit distinct valid payments and one response is retried
- **THEN** two bills are created, the retry creates no third bill, and the bills receive distinct sequential per-outlet numbers

### Requirement: Official number order may differ from order chronology
Official bill numbers SHALL be allocated in successful server-acceptance order. The system SHALL retain and display ordered time, payment time, and their explicit business dates independently and SHALL NOT use bill number as a substitute for chronological accounting order.

#### Scenario: Offline device syncs after an online device
- **WHEN** an earlier offline payment reaches the server after a later online payment
- **THEN** each retains its original ordered/payment facts while official numbers follow server acceptance order without collision or reuse

### Requirement: Every participating device must be settlement-ready
Business-day sign-off SHALL require a current server seal from every device that
held a grant or command for the date, no live grant, and no open order. A seal or
health report from one device SHALL NOT satisfy another device's blocker.

#### Scenario: Second device remains offline
- **WHEN** one device is reconciled and sealed but another participating device has not reconnected and sealed
- **THEN** the outlet date remains blocked from sign-off and identifies the unresolved device without exposing its payloads
