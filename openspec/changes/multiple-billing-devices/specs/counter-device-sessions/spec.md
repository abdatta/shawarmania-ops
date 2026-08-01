## ADDED Requirements

### Requirement: Daily grants and revocation are device-specific
Each enrolled device SHALL create and enforce its own operator grants. Revocation or grant expiry on one device SHALL NOT terminate a grant on another device, and no grant SHALL authorize a device or outlet other than the one recorded on it.

#### Scenario: Same operator opens two counters
- **WHEN** an eligible operator authenticates independently on two devices at the same outlet
- **THEN** the server records two device-specific grants and attributes each command to its actual device and grant

### Requirement: Active device labels are unique within an outlet
An active billing device SHALL have a human-readable label unique among active devices at its outlet so management, order ownership, and recovery targets are unambiguous.

#### Scenario: Duplicate active label is submitted
- **WHEN** an admin attempts to enrol or rename a device to an active same-outlet label
- **THEN** the system refuses the duplicate without revealing another outlet's labels
