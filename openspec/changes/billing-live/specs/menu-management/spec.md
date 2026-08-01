## ADDED Requirements

### Requirement: The live counter prefers the latest reachable menu
While the backend is reachable, the billing device SHALL fetch the latest menu for its enrolled outlet and SHALL NOT silently prefer a cached version. During an active authenticated counter session, an actual backend failure MAY fall back to that session's last successful snapshot and SHALL display an offline banner.

#### Scenario: Price changes while the counter is online
- **WHEN** the counter refreshes after an authorized menu price change and the backend responds
- **THEN** newly added lines use the latest price while already captured order and bill lines retain their snapshots

#### Scenario: Backend drops during an active counter session
- **WHEN** the menu was loaded successfully and a later refresh receives no backend response
- **THEN** the counter may continue from the active-session snapshot, marks the screen offline, and snapshots the displayed item name and price into each new line

#### Scenario: App starts without a reachable backend
- **WHEN** the billing app reloads or starts and cannot authenticate online or fetch a fresh menu
- **THEN** V1 does not open new billing work from a persisted cache and instead offers pending-delivery and recovery status
