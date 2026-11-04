## MODIFIED Requirements

<!-- Applies on top of retire-fewer-requests' delta of the same requirement: archive that first. -->

### Requirement: A tablet's health report carries the gate answers

A tablet's minute health report SHALL return every
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
