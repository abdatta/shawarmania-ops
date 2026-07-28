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

### Requirement: A required text column is never satisfied by an empty string

A required text column SHALL refuse a value that is empty or entirely
whitespace, and not only one that is absent. This applies to every `not null`
text column a person fills in and a person later reads. `not null` alone SHALL
NOT be treated as sufficient, because it constrains absence rather than
emptiness — an empty string satisfies it while satisfying nothing anybody needs.

This SHALL hold for columns whose surface does not exist yet, so that a form
written later inherits the guarantee rather than rediscovering its absence. A
column added after this requirement SHALL carry the same guard in the migration
that creates it, in the same way an outlet-scoped table ships its Row-Level
Security policy in the change that creates it.

#### Scenario: A required text column refuses an empty string

- **WHEN** any caller writes an empty string to a required text column, on
  insert or on update
- **THEN** the database refuses the write

#### Scenario: A required text column refuses whitespace

- **WHEN** any caller writes a value of only spaces to a required text column
- **THEN** the database refuses the write, because whitespace is the case a
  not-null constraint silently accepts

#### Scenario: A surface built later inherits the guard

- **WHEN** a form is written for a column that was guarded before the form
  existed, and it submits a blank value
- **THEN** the database refuses it, whether or not that form checked first
