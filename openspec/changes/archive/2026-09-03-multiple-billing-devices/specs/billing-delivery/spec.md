## ADDED Requirements

### Requirement: A queue belongs to one tablet and never to its outlet

Each tablet SHALL retain and drain only its own envelopes, dependency edges,
results and local resolutions. No tablet SHALL become responsible for, or gain
visibility of, another tablet's queue, and correction, discard and drain SHALL
remain available only on the tablet that created the work.

Telemetry MAY publish non-identifying aggregate state per tablet and SHALL NOT
copy payloads or customer facts anywhere, for monitoring or otherwise.

#### Scenario: One tablet is offline

- **WHEN** one tablet at an outlet loses connectivity while the other keeps trading
- **THEN** each drains from its own store, the online tablet neither delivers nor displays the offline tablet's commands, and neither counter is blocked by the other

#### Scenario: A refusal stops one chain and no other tablet

- **WHEN** a command is permanently refused on one tablet
- **THEN** its descendants stop on that tablet alone, and the other tablet's unrelated chains keep draining

### Requirement: Removing one tablet does not disturb another's delivery

Refusal of a removed tablet's commands, and the handling of the work left on it,
SHALL NOT stop or delay delivery from any other active tablet at the same outlet.

#### Scenario: One tablet is removed mid-service

- **WHEN** an admin removes one of two tablets while both hold unsent work
- **THEN** the removed tablet's requests are refused at the database and its envelopes stay on the device, while the other tablet continues billing and draining without interruption
