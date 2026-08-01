## ADDED Requirements

### Requirement: Biller is an Employee-capable assignment without becoming a second role

A live `biller` assignment SHALL confer the personal attendance and Employee
surface capabilities of an Employee at that outlet in addition to eligibility
to open its registered counter. Promotion from Employee to Biller SHALL replace
the one assignment rather than create a second assignment.

#### Scenario: Biller signs in on a personal device
- **WHEN** a person with a Biller assignment signs in outside registered-device context
- **THEN** they receive their own Employee attendance surfaces and no counter surface

#### Scenario: Employee is promoted
- **WHEN** an authorized admin promotes an Employee to Biller at the same outlet
- **THEN** one live Biller assignment remains and their existing attendance history and personal login are unchanged

### Requirement: Counter credential verification retains no personal login material

The registered-device flow SHALL use credentials only to establish an eligible
billing grant. It SHALL NOT persist the identifier, password, human access
token, human refresh token, or associated email on the tablet.

#### Scenario: Admin opens a counter grant
- **WHEN** an FA or SA authenticates successfully on a registered device
- **THEN** their human session material is discarded and subsequent requests remain limited to the machine's billing context
