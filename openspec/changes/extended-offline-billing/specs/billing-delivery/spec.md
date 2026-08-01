## ADDED Requirements

### Requirement: Delivery supports intentional extended-outage capture
Within a previously verified unexpired daily grant, the billing delivery store SHALL continue accepting commands after offline app restart and SHALL retain them until real backend reachability returns or an authorized recovery flow resolves them.

#### Scenario: Device remains offline for the rest of the shift
- **WHEN** the counter has a verified grant, restarts offline, and accepts commands until cutoff
- **THEN** every command remains durable and dependency-ordered without requiring the tab or app to stay open continuously

### Requirement: Learned revocation freezes ordinary offline delivery
When the device learns that its registration is revoked, it SHALL stop ordinary delivery and new command acceptance while preserving all local envelopes for authenticated recovery.

#### Scenario: Reconnect reveals revocation
- **WHEN** the first successful server response after an outage reports the device revoked
- **THEN** the app freezes ordinary billing and drain, preserves local evidence, and offers only the authorized recovery path
