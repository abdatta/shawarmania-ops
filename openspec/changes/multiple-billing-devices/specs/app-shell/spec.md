## ADDED Requirements

### Requirement: Device management supports a collection rather than a singleton
Authorized FA/SA management navigation SHALL list all devices in scope and SHALL require an explicit device target for inspect, revoke, health, recovery, and order-transfer actions.

#### Scenario: Admin selects a recovery target
- **WHEN** an admin transfers a stranded order at an outlet with several devices
- **THEN** the interface identifies the source and permits only an active same-outlet target
