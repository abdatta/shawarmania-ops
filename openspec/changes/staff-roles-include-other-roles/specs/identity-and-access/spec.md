## MODIFIED Requirements

### Requirement: Biller is an Employee-capable assignment without becoming a second role

Which staff role includes which SHALL be written down once, as rows each saying
that one staff role can do everything another can, held by the database as a
table and by the app as one map, and read transitively: a role includes every
role the roles it includes include. A role MAY include several roles and MAY be
included by several. The rows SHALL contain no rank or number, and the database
SHALL refuse a row that makes a role include itself, directly or through others.
Every check of what a staff member may do SHALL ask whether a role the person
holds at that outlet includes the role it needs, and SHALL NOT compare a role to
a staff role by name. Managers and the owner SHALL NOT be staff roles.

The rows SHALL say that a Biller includes an Employee. A live Biller assignment
SHALL therefore confer personal attendance and Employee surface capabilities at
that outlet, plus eligibility to hold a shift on its counter tablet. One person
SHALL hold at most one live role at an outlet, so the staff roles SHALL be
offered as alternatives rather than simultaneous selections.

#### Scenario: Biller signs in on a personal device

- **WHEN** a person with a Biller assignment signs in outside tablet context
- **THEN** they receive their Employee attendance surfaces and no counter surface

#### Scenario: Employee is promoted

- **WHEN** an authorized admin promotes an Employee to Biller at the same outlet
- **THEN** one live Biller assignment remains and attendance history, personal login, password, and active session are unchanged

#### Scenario: Same-outlet roles cannot be stacked

- **WHEN** a UI or hand-crafted request attempts to retain Employee and Biller simultaneously at one outlet
- **THEN** the request is refused

#### Scenario: The includes rows give today's answers

- **WHEN** `role-includes` is on and an Employee, a Biller, a Manager and the owner each check in, record an expense, read the counter's menu and change a person's role
- **THEN** each is admitted or refused exactly as with the gate off

#### Scenario: Roles that branch

- **WHEN** the rows say a Cook includes a Waiter and a Biller includes a Waiter
- **THEN** a Cook and a Biller each act as a Waiter, and neither acts as the other

#### Scenario: A loop

- **WHEN** a migration writes a row making Employee include Biller while Biller includes Employee
- **THEN** the database refuses it

#### Scenario: A manager is not staff

- **WHEN** a Franchise Admin with no staff assignment at an outlet is asked whether they act as an Employee there
- **THEN** the answer is no

#### Scenario: A role listed by name

- **WHEN** a migration or an app file lists staff roles by name outside the includes rows and their map
- **THEN** lint fails and names the helper to use instead
