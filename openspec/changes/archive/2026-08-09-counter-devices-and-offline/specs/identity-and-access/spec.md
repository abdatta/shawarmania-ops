## ADDED Requirements

### Requirement: Biller is an Employee-capable assignment without becoming a second role

A live `biller` assignment SHALL confer the personal attendance and Employee
surface capabilities of an Employee at that outlet, in addition to eligibility to
hold a shift on its counter tablet. Promotion from Employee to Biller SHALL
replace the one assignment rather than create a second one.

#### Scenario: Biller signs in on a personal device
- **WHEN** a person with a Biller assignment signs in outside tablet context
- **THEN** they receive their own Employee attendance surfaces and no counter surface

#### Scenario: Employee is promoted
- **WHEN** an authorised admin promotes an Employee to Biller at the same outlet
- **THEN** one live Biller assignment remains, and their attendance history and personal login are unchanged

### Requirement: No account credential is ever accepted on a counter tablet

A counter tablet SHALL NOT accept a password, and SHALL NOT hold a human access
token, refresh token, identifier or associated email at any point. The only
account identifier it handles is the username submitted with a shift request,
which SHALL grant nothing on its own.

#### Scenario: The tablet is asked for a password
- **WHEN** any counter surface is reached on a set-up tablet
- **THEN** no password field exists on it, at setup or at shift opening

#### Scenario: An approved shift leaves no personal session
- **WHEN** an FA or SA approves their own shift request from their phone
- **THEN** the tablet's subsequent requests remain limited to its device session and cannot call personal or admin adapters

### Requirement: Eligibility is re-derived from the database at approval

Approving a shift request SHALL re-derive the approver's current assignments,
account state and outlet from the database, never from the request body or from
any claim in a token. An approval SHALL attribute the shift to the authenticated
approver only.

#### Scenario: Request body names another operator
- **WHEN** an approval names a different eligible person's ID
- **THEN** the function attributes the shift to the authenticated caller or refuses the request

#### Scenario: Assignment ended between request and approval
- **WHEN** the person's assignment ends after the request is created and before it is approved
- **THEN** approval is refused and no shift opens
