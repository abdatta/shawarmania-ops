## ADDED Requirements

### Requirement: Service choices and service facts are isolated like the rows they sit on

An outlet's service choices SHALL be readable by the principals that may read that
outlet's row, and by a counter device for its own outlet only. They SHALL be
writable by the owner, and by a Franchise Admin for the outlets they manage, and
by nobody else; a manager's write SHALL reach these choices and no other column
of the outlet row.

An order's and a bill's type and table, and a line's kind, SHALL be readable by
exactly the principals that may read that order, bill or line, and by no other.

The isolation suite SHALL cover each by hand-crafted request.

#### Scenario: A neighbouring tablet

- **WHEN** a counter device of one outlet requests another outlet's service choices
- **THEN** nothing is returned

#### Scenario: A neighbouring manager

- **WHEN** a Franchise Admin requests the type and table of another outlet's orders
- **THEN** nothing is returned
