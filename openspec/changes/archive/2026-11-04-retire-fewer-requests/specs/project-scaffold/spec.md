## RENAMED Requirements

- FROM: `### Requirement: The request budget holds lower with the gate on`
- TO: `### Requirement: The request budget holds lower`

## MODIFIED Requirements

### Requirement: A screen re-reads what changed, not on a timer

A screen SHALL re-read data when a change notice, its own write, its first load,
or a return to the foreground calls for it, and SHALL NOT re-read data that no
notice says has changed. Notices arriving within `NOTICE_BURST_MS` of each other
SHALL be answered by one read. A count already on screen SHALL be re-read on a
return to the foreground only when it is older than `FOREGROUND_REREAD_AFTER_MS`.
The freshness constants SHALL be named once, in `src/lib/freshness.ts`.

#### Scenario: The kitchen does not re-read unchanged categories

- **GIVEN** a kitchen board
- **WHEN** the board is re-read and its filter is unchanged
- **THEN** no request for the menu categories is made

#### Scenario: A sale does not reload a fresh menu

- **GIVEN** a counter whose menu was loaded less than two minutes ago
- **WHEN** an order or a bill change notice arrives
- **THEN** the bills and the rail are refreshed once for the burst
- **AND** the menu is not reloaded

#### Scenario: A menu change still reaches the counter at once

- **GIVEN** a counter
- **WHEN** a menu category or dish change notice arrives
- **THEN** the menu is reloaded

#### Scenario: A badge does not re-read a fresh count on returning

- **GIVEN** a badge whose count was read less than two minutes ago
- **WHEN** the page returns to the foreground
- **THEN** no request is made for it

### Requirement: A tablet's health report carries the gate answers

With `tablet-health` on, a tablet's minute health report SHALL return every
live gate's answer, and the tablet SHALL treat that as its
minute gate read. If a report fails, the tablet SHALL read the gates directly,
so a turned gate reaches every tablet within a minute.

#### Scenario: The report's answers raise an update

- **GIVEN** a tablet whose page booted with a gate off
- **WHEN** a health report returns that gate on
- **THEN** the update signal is raised once

#### Scenario: A failed report falls back to a read

- **GIVEN** a tablet sending its health report on the v2 path
- **WHEN** the report fails
- **THEN** the gates are read directly in its place

### Requirement: The request budget holds lower

An idle counter's and kitchen's minute and one payment SHALL stay within budgets
lower than the request budget's, measured from the-app-asks-the-server-less and
recorded in `e2e-auth/fewer-requests.spec.ts`.

#### Scenario: An idle kitchen makes no category reads

- **GIVEN** a kitchen board idle for a measured minute
- **THEN** its requests stay within the lower budget
