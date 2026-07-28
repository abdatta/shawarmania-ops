## ADDED Requirements

### Requirement: A person's name is never blank

A roster row and an app account SHALL each carry a non-empty full name,
enforced by the database and not only by a form. A name consisting entirely of
whitespace SHALL be refused.

A name is the only field on either record that a human reads to know who the
record is about. A staff code disambiguates two people with the same name; it
does not identify a person with no name at all. The same reasoning that made a
blank staff code unacceptable applies with more force to the name beside it.

The surface that writes the record SHALL refuse before writing and SHALL name
the field that is missing, on the Staff surface and on the account-provisioning
surface alike.

#### Scenario: A roster row cannot be created without a name

- **WHEN** an admin submits the Staff form with the full name empty or
  containing only spaces
- **THEN** no roster row is created, and the form says which field is missing

#### Scenario: An account cannot be provisioned without a name

- **WHEN** an admin submits the provisioning form with the full name empty or
  containing only spaces
- **THEN** no account is created, no one-time code is issued, and the form says
  which field is missing

#### Scenario: The database refuses a blank name whatever the client sends

- **WHEN** any caller inserts or updates a roster row or a profile whose full
  name is empty or entirely whitespace, including by a request that bypasses
  the form
- **THEN** the database refuses the write

#### Scenario: An existing person cannot be edited into a nameless one

- **WHEN** an admin edits a roster row and clears the full name
- **THEN** the write is refused and the row keeps the name it had
