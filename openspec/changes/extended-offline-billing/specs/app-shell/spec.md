## ADDED Requirements

### Requirement: The enrolled shell has a constrained offline-resume state
After restart without backend reachability, the app shell SHALL expose billing pages only when a complete same-device generation proves an unexpired previously verified daily grant. It SHALL expose pending/recovery status but no new billing when that proof is absent or expired.

#### Scenario: Valid offline resume
- **WHEN** an enrolled device restarts offline before the cached grant cutoff
- **THEN** the billing-only shell opens with persistent offline provenance and no personal-role pages

#### Scenario: Offline restart after cutoff
- **WHEN** the same device restarts offline after the cached grant cutoff
- **THEN** the shell withholds new billing and directs the operator to reconnect and sign in
