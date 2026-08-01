## ADDED Requirements

### Requirement: Local queues remain isolated by physical device
Each billing device SHALL retain and drain only its own local envelopes. Device health reporting MAY publish non-PII aggregate state but SHALL NOT copy payloads or make one device responsible for another device's queue.

#### Scenario: One device is offline
- **WHEN** one same-outlet device loses connectivity while another remains online
- **THEN** each continues from its own state and the online device neither drains nor exposes the offline device's command payloads

### Requirement: Revoked-device results do not block other devices
Server refusal or recovery of one revoked device's commands SHALL NOT stop unrelated delivery from another active same-outlet device.

#### Scenario: Revoked queue enters recovery
- **WHEN** an admin recovers eligible work from one revoked device
- **THEN** other active devices continue ordinary billing and delivery independently
