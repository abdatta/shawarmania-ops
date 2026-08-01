## ADDED Requirements

### Requirement: A complete verified generation can bootstrap the counter offline
After a successful online hydration, the enrolled device SHALL atomically persist the device/outlet identity, daily grant bounds, cutover, menu snapshot, open-order projections, cache provenance, and schema version needed to reconstruct that counter. An offline restart SHALL use only a complete compatible generation for that same device and outlet.

#### Scenario: App restarts during an extended outage
- **WHEN** the enrolled device restarts without a backend response before its cached verified daily grant expires
- **THEN** the app reconstructs the constrained counter from its newest complete compatible generation and clearly marks it offline

#### Scenario: Cached generation is incomplete or incompatible
- **WHEN** the app cannot read a complete supported generation for the current device
- **THEN** it refuses new offline billing, preserves pending commands, and requires online recovery

### Requirement: Offline resumption never extends daily authorization
Offline billing SHALL be available only within the explicit bounds of a daily grant previously created by online credential verification. It SHALL stop new commands at cutoff and SHALL require online authentication and fresh hydration for a new business day.

#### Scenario: Cutoff arrives during an outage
- **WHEN** the cached grant reaches its outlet cutoff while the backend remains unavailable
- **THEN** the app stops accepting new billing commands, retains historical pending work, and requires online re-sign-in

### Requirement: Offline projections disclose provenance and freshness
Every surface using persisted server data SHALL show that the device is offline and the time of its last successful hydration. It SHALL NOT label cached menu, customer, order, or bill state as current server truth.

#### Scenario: Operator views a cached menu
- **WHEN** billing resumes offline from a verified generation
- **THEN** the menu remains usable with a persistent offline banner and visible last-sync provenance

### Requirement: Device-owned order state is reconstructed from immutable commands
The offline counter SHALL derive each open order by reducing the device's accepted local command chain over its last authoritative projection using integer-paise arithmetic and optimistic versions. It SHALL NOT allocate an official bill number locally.

#### Scenario: Offline order is edited and paid after restart
- **WHEN** the device resumes offline, revises one of its open orders, and accepts full payment
- **THEN** the reconstructed order reflects the local chain, the payment receives a provisional reference, and the official bill is deferred to server acceptance

### Requirement: Offline exact-phone reuse is narrowly cached
The device MAY reuse a customer result only for the exact normalized phone previously resolved online on that device and SHALL label it cached. It SHALL NOT expose directory browse, prefix search, or another customer's cached result, and an unknown number SHALL remain unresolved until sync.

#### Scenario: Previously resolved phone is entered offline
- **WHEN** the operator enters the exact full phone of a cached customer during an outage
- **THEN** the app may offer the cached form autofill with offline provenance and the same replacement warning

#### Scenario: New phone is entered offline
- **WHEN** the phone has no exact cached result
- **THEN** the app permits optional form snapshots but explains that customer identity will be resolved on sync

### Requirement: Reconnection preserves evidence before refreshing truth
On restored backend reachability, the device SHALL verify device/grant status, preserve every local envelope, deliver eligible dependency chains idempotently, quarantine explicit conflicts, and then replace cached projections with authoritative results.

#### Scenario: Twenty commands accumulated through restart
- **WHEN** the device reconnects with twenty valid pending commands, including a lost response replay
- **THEN** each effect lands exactly once, conflicts remain explicit, and the refreshed projections reconcile to server results

### Requirement: Offline state cannot satisfy business-day sign-off
An offline device SHALL NOT create or imply a device-day settlement seal. It
SHALL reconnect, verify device status, deliver or explicitly resolve every local
command for the date, end its grant, and obtain the server seal before #12 may
sign that date off.

#### Scenario: Cutoff passes while commands remain offline
- **WHEN** the outlet reaches cutoff with locally accepted commands not yet reconciled
- **THEN** new billing stops and the date remains visibly blocked from sign-off until online reconciliation and sealing complete
