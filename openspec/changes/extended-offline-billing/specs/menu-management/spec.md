## ADDED Requirements

### Requirement: A verified persisted menu may bootstrap offline billing
After an online hydration, the device SHALL persist the enrolled outlet's menu snapshot with its source generation and last-sync time. It MAY use that snapshot to start or resume billing offline within the same verified daily grant and SHALL replace it with the latest menu whenever the backend responds.

#### Scenario: Price changed elsewhere during the outage
- **WHEN** the device creates lines from its verified cached menu and later reconnects after a server-side price change
- **THEN** those lines retain their captured cached name and price while future lines use the refreshed menu
