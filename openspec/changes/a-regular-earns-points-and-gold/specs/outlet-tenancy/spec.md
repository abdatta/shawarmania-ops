## ADDED Requirements

### Requirement: Loyalty rules, points and gold are isolated by outlet

An outlet's loyalty rules SHALL be readable by the principals that may read that
outlet's row, and by a counter device for its own outlet only, and writable by
the owner and by a Franchise Admin for the outlets they manage, reaching no other
column of the outlet row.

Points entries and memberships SHALL each carry their outlet, SHALL be readable
directly only by the owner and by a Franchise Admin of that outlet, and SHALL be
written only by the server's own functions and triggers. A counter SHALL learn a
balance and a membership only through the lookup, for its own outlet.

The isolation suite SHALL cover each by hand-crafted request.

#### Scenario: A neighbouring manager reads entries
- **WHEN** a Franchise Admin requests another outlet's points entries or memberships
- **THEN** nothing is returned

#### Scenario: A counter reads the table
- **WHEN** a counter device or Biller selects from the points entries directly
- **THEN** nothing is returned

#### Scenario: A client writes an entry
- **WHEN** any principal inserts a points entry or a membership directly
- **THEN** the database refuses it
