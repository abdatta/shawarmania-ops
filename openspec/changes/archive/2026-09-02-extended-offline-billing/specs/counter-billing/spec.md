## ADDED Requirements

### Requirement: A resumed counter states what it remembers and when it read it

A counter opened from a resume record SHALL carry a persistent line saying the
tablet is offline and when it last read successfully, and the menu grid, the
preparation pipeline and Bills this shift SHALL each be readable as of that time.

Because the pipeline is outlet-wide, an offline counter SHALL present it as a
remembered outlet read rather than as current work, and SHALL NOT imply that
another tablet's cards or a manager's clearance have been seen. The existing sync
indicator SHALL continue to carry pending counts and its escalated state
unchanged.

When the last observed server time and the device clock materially disagree, the
counter SHALL show both and SHALL correct neither.

#### Scenario: The workspace is read after a cold start

- **WHEN** an operator uses a counter resumed from a resume record
- **THEN** the offline line names the last successful read, and the menu, pipeline and bills are each labelled as of it

#### Scenario: The clock disagrees with the last server reading

- **WHEN** the device clock differs materially from the server time observed at the last successful read
- **THEN** both are shown, the counter warns, and neither clock is silently adjusted

### Requirement: Finish Day says why it cannot run offline

Finish Day SHALL require authoritative server state. With no backend reachable
the readiness sheet SHALL open, state that the day cannot be finished until the
tablet reconnects, list the local work outstanding by category, and offer no
completion. It SHALL NOT present a countdown, a local confirmation, or a way to
proceed.

#### Scenario: Finish Day during an outage

- **WHEN** an operator opens Finish day with no backend reachable
- **THEN** the sheet explains that server state is unavailable, names the unsent and needs-attention categories, and offers only to keep billing

#### Scenario: Finish Day immediately after reconnecting

- **WHEN** the backend becomes reachable and the drain resolves every command
- **THEN** the ordinary readiness sheet applies unchanged, including its advisory tender-edit prompt
