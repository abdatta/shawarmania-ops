## ADDED Requirements

### Requirement: A tablet may re-enter its own live shift without the server, and may never open one

A set-up tablet SHALL be able to reopen a shift **it already holds** from its own
resume record when no backend response is available, provided the record is
complete, names this installation, and the shift has not ended and has neither
expired nor passed the outlet cutover.

Requesting, confirming, handing over and leaving a shift SHALL remain online
operations, because each requires the server and the operator's own device. No
offline path SHALL create a shift, extend one, admit a different operator, or
substitute for the four-digit confirmation.

#### Scenario: The tablet resumes the shift it already had

- **WHEN** the tablet cold-starts offline holding a resume record for an unexpired approved shift
- **THEN** the same shift, operator and business date are in force, and no confirmation is requested or accepted

#### Scenario: A new operator arrives during an outage

- **WHEN** somebody attempts to open or hand over a shift while the backend is unreachable
- **THEN** the tablet explains that opening a counter needs the connection and the person's own phone, and no shift changes

#### Scenario: Removal is unknown while offline

- **WHEN** the tablet is removed by an admin while it is offline
- **THEN** the resumed counter cannot learn of it, says plainly that this cannot be checked while offline, and every command it captured is refused by the database once it reconnects
