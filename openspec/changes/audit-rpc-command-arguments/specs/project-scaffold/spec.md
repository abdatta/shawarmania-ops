## ADDED Requirements

### Requirement: Database commands are verified as serialized requests

Every database command caller SHALL send every parameter that the final database
function signature requires. A required fact whose value is unknown SHALL remain
present after JSON serialization with an explicit null value; a caller MAY omit
an argument only when the database signature deliberately declares a default.

Each new database command family SHALL cover any required empty or unknown
variant both at the serialized payload boundary and over the real HTTP transport.
A mock-adapter test or a direct SQL call SHALL NOT be treated as proof of that
wire behavior.

#### Scenario: A required unknown value survives serialization

- **WHEN** a command is issued without a reading or other legitimately unknown
  required fact
- **THEN** the serialized JSON still contains that argument with a null value
- **AND** the real transport resolves and executes the intended database function

#### Scenario: A defaulted argument may be omitted

- **WHEN** a caller leaves out an argument whose final database signature
  declares a default
- **THEN** the request resolves the intended function and the database applies
  that declared default

#### Scenario: A new command family proves its empty variant

- **WHEN** a change adds a database command whose required input can be empty or
  unknown
- **THEN** its verification asserts the post-serialization key and value and
  proves the same variant against the real HTTP transport
