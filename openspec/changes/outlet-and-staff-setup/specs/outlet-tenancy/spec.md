## ADDED Requirements

### Requirement: An outlet is created and edited from the app, by the owner only

The Super Admin SHALL be able to create an outlet and edit an existing one from
a surface in the app, supplying its code, name, location label, address, phone,
business-day cutover and active state. No other role SHALL be offered either
action, and the database SHALL refuse both for any other role regardless of
what a client sends — the `outlets_insert` and `outlets_update` policies are
the boundary, not the presence of a button.

An outlet code SHALL be unique across the business, and an attempt to reuse one
SHALL be refused with a message naming the collision rather than a raw database
error.

#### Scenario: The owner creates the first outlet

- **WHEN** a Super Admin with no outlets in the database submits a new outlet
- **THEN** the outlet exists, appears in the list, and is immediately available
  to assign accounts to

#### Scenario: A Franchise Admin cannot create or edit an outlet

- **WHEN** a Franchise Admin's session attempts to insert an outlet, or to
  update any outlet row including their own
- **THEN** the database refuses the write, and no outlet surface is offered to
  that role

#### Scenario: A duplicate outlet code is refused legibly

- **WHEN** a Super Admin submits an outlet whose code is already in use
- **THEN** the write is refused and the form explains that the code is taken

### Requirement: An empty database presents an instruction, not a blank screen

Every surface reachable before any outlet exists SHALL render a usable state
with zero rows present. The Outlets surface with no outlets SHALL offer the
action that creates the first one; the account form with no outlets SHALL state
that an outlet must exist before an account can be assigned to one, rather than
presenting an empty selector.

#### Scenario: First sign-in on an empty database

- **WHEN** the Super Admin signs in and no outlet exists
- **THEN** the Outlets surface tells them to create one and offers the control
  that does it

#### Scenario: Provisioning before any outlet exists

- **WHEN** an admin opens the account form and no outlet exists
- **THEN** the outlet field explains that an outlet is needed first, and the
  form does not offer to create an outlet-less account in a scoped role

### Requirement: Deactivating an outlet stops trading without destroying anything

An outlet SHALL carry an active state that the Super Admin can set. A
deactivated outlet SHALL disappear from assignment lists and operating views,
and SHALL NOT cascade: its accounts, its roster rows and its recorded
attendance SHALL remain exactly as they were, and reactivation SHALL restore
the outlet with all of them intact.

The confirmation for deactivation SHALL state what it does not do, so that an
owner who expects it to revoke logins is corrected before acting.

#### Scenario: Deactivation leaves accounts and history intact

- **WHEN** a Super Admin deactivates an outlet that has accounts, roster rows
  and recorded attendance
- **THEN** all of those rows still exist and are unchanged, and reactivating the
  outlet restores it to the lists it left

#### Scenario: A deactivated outlet is not offered for assignment

- **WHEN** an admin opens the account form after an outlet is deactivated
- **THEN** that outlet is not among the outlets an account can be assigned to
