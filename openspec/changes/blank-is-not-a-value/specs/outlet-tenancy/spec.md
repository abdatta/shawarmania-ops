## ADDED Requirements

### Requirement: An outlet's identifying fields are never blank

An outlet's name, short code and location label SHALL each carry a non-empty
value, enforced by the database and not only by a form. A value consisting
entirely of whitespace SHALL be refused, because these three fields are how
every surface in the app names the outlet — a blank one produces a row that
appears in lists, is offered for assignment, and identifies nothing.

The refusal SHALL hold on edit as well as on creation. Clearing a name is the
same mistake as never typing one.

The form SHALL refuse before writing, and SHALL name the field that is missing
rather than reporting that the write failed. The database is the boundary; the
form is the convenience, and both are required.

#### Scenario: An outlet cannot be created without a name

- **WHEN** a Super Admin submits the outlet form with the name left empty, or
  containing only spaces
- **THEN** no outlet is created, and the form says which field is missing

#### Scenario: The database refuses a blank name whatever the client sends

- **WHEN** any caller inserts or updates an outlet whose name, code or location
  label is empty or entirely whitespace, including by a hand-crafted request
  that bypasses the form
- **THEN** the database refuses the write

#### Scenario: An existing outlet cannot be edited into a blank one

- **WHEN** a Super Admin edits an existing outlet and clears its name
- **THEN** the write is refused and the outlet keeps the name it had
