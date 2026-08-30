## MODIFIED Requirements

### Requirement: Delayed commands use historical shift validity

A delayed command SHALL retain its referenced tablet, shift, operator, immutable
client creation time and business date. A command created before a shift ended
remains ordinarily eligible. A command created after a remote `operator` end MAY
be accepted only before that shift's expiry and before another shift opens on the
tablet; it SHALL carry an immutable after-departure flag and the snapshotted end
time. It SHALL NOT be reassigned to a later operator.

A command created after deliberate day finish, tablet removal, shift expiry, or
the opening of a later shift SHALL be refused permanently.

#### Scenario: Offline tablet records a sale after remote leave

- **WHEN** a tablet durably creates a sale after its operator left remotely but before it could learn that fact, and no later shift had opened at creation time
- **THEN** the sale is accepted exactly once with the former shift and operator context, marked recorded after shift end, financially included, and never inherited by a later operator

#### Scenario: A later shift already owns the tablet

- **WHEN** an old-shift command claims a creation time at or after the next shift opened
- **THEN** it is refused permanently rather than attributed to either operator

#### Scenario: Finish Day has ended the shift

- **WHEN** a command claims a creation time after the tablet deliberately finished the day
- **THEN** it is refused permanently even when an old client view still references the ended shift
