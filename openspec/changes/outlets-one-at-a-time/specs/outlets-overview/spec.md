## MODIFIED Requirements

### Requirement: Outlet status names tablet availability and links to its source

The one-minute heartbeat SHALL remain. A successfully activated, non-removed tablet heard from within three minutes SHALL count online. All expected tablets online SHALL show Online with a green dot; some SHALL show Online with a yellow dot, and SHALL say to a screen reader that some tablets are offline; none SHALL show Offline with a red dot. Unknown status SHALL NOT claim Offline. No offline-tablet attention alert or visible online count SHALL be shown. The status SHALL link to that outlet's page on Outlets, where its tablets are.

The words Open and Closed SHALL NOT be used for this status: they name whether an outlet is trading, on Outlets, and a live reading of its tablets is a different fact.

#### Scenario: Partial availability

- **WHEN** one of two activated tablets is online
- **THEN** the outlet shows Online with a yellow dot, linked to that outlet's page on Outlets

#### Scenario: No tablet reachable

- **WHEN** none of an outlet's tablets has been heard from within three minutes
- **THEN** the outlet shows Offline with a red dot, and never Closed
