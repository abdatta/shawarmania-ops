# Outlet Tenancy

## Purpose

Guarantees that an outlet's data belongs to that outlet alone, enforced in the database rather than the UI. A Franchise Admin, Biller, or Employee session cannot read or write another outlet's rows by any means — including hand-crafted API requests with a valid session — and the guarantees that must be immediate (deactivation, device revocation) are immediate. Coverage is enumerated from the schema itself, so a new table cannot silently opt out.

## Requirements

### Requirement: Outlet isolation is enforced by the database on every outlet-scoped table

Every outlet-scoped table SHALL have Row-Level Security enabled with policies
that restrict reads and writes to the requesting session's outlet. A Franchise
Admin, Biller, or Employee session MUST NOT be able to read or write another
outlet's rows by any means — including a hand-crafted API request that names
another outlet's identifier explicitly, with a valid session.

#### Scenario: Franchise Admin reads only their own outlet

- **WHEN** a Franchise Admin scoped to Kalyani lists rows of any outlet-scoped table
- **THEN** only Kalyani's rows are returned

#### Scenario: Hand-crafted read naming the other outlet

- **WHEN** the same session issues a request explicitly filtered to Kanchrapara's outlet id
- **THEN** zero rows are returned, because the database policy excludes them

#### Scenario: Hand-crafted write naming the other outlet

- **WHEN** a Franchise Admin, Biller, or Employee session attempts an insert or update carrying the other outlet's `outlet_id`
- **THEN** the database rejects the write

#### Scenario: Super Admin reads across outlets

- **WHEN** a Super Admin session lists rows of an outlet-scoped table
- **THEN** rows from every outlet are returned

### Requirement: Session tokens carry role and outlet identity as claims

Access tokens SHALL carry the session's role and outlet identity as claims,
injected at token issue time from the profile record. Row-Level Security
policies SHALL read scope from these claims and MUST NOT determine scope by
querying the profiles table per row.

#### Scenario: Claims are present in a real token

- **WHEN** a seeded user signs in through the auth service and the issued access token is decoded
- **THEN** it contains that user's role and outlet identity as claims

#### Scenario: Policies enforce scope from claims alone

- **WHEN** a session whose claims scope it to outlet A queries an outlet-scoped table
- **THEN** rows are filtered by the claimed outlet without a per-row profile lookup

### Requirement: Account deactivation takes effect immediately

A deactivated account SHALL lose all read and write access at the next
request, without waiting for its token to expire.

#### Scenario: Deactivated account is blocked with a live token

- **WHEN** an account is marked inactive and a request is made with its still-valid token
- **THEN** the database returns no rows and accepts no writes for that session

### Requirement: Counter device revocation takes effect immediately

A revoked counter device SHALL lose all read and write access at the next
request, without waiting for its session token to expire.

#### Scenario: Revoked device is blocked with a live session

- **WHEN** a counter device is revoked and a request is made with its still-valid session
- **THEN** the database returns no rows and accepts no writes for that device

### Requirement: An Employee reads only their own records

An Employee session SHALL read only their own attendance rows, and none of any
colleague, in either outlet.

#### Scenario: Employee lists attendance

- **WHEN** an Employee lists attendance rows
- **THEN** only rows for their own employee record are returned

#### Scenario: Employee requests a colleague's rows

- **WHEN** an Employee issues a request explicitly naming a colleague's employee id
- **THEN** zero rows are returned

### Requirement: A Biller reads only their own shift's bills

A Biller (counter device) session SHALL read only bills belonging to shifts
open on that device, not the outlet's full billing history.

#### Scenario: Device lists bills

- **WHEN** a counter device session lists bills
- **THEN** only bills of shifts open on that device are returned

### Requirement: Isolation coverage is enumerated, not remembered

The isolation test suite SHALL derive the set of outlet-scoped tables from the
database catalog and SHALL fail if any table in the public schema lacks
Row-Level Security, or is not covered by an isolation test case, or cannot be
classified as outlet-scoped, child-scoped, or global.

#### Scenario: A new table without a policy fails the suite

- **WHEN** a table is added to the public schema without Row-Level Security or without a corresponding isolation case
- **THEN** the isolation suite fails, naming the table

### Requirement: Seed data spans both outlets and contains no real people

Seed fixtures SHALL create both real outlets (Kalyani and Kanchrapara) with
their owner-confirmed business-day cutover and geofence radius, the real menu,
and only synthetic people with obviously fake contact details. Seeds MUST
produce at least two outlets, so isolation failures have something to fail
against.

#### Scenario: Fresh database is seeded

- **WHEN** the local database is reset with seeds applied
- **THEN** both outlets exist with cutover 04:00 and geofence radius 150 m, the real menu is present, and every person, phone number, and credential is synthetic

### Requirement: Account invitations are outlet-scoped and their codes are unreadable

The record of an outstanding one-time code SHALL be outlet-scoped like every
other outlet-scoped table, with Row-Level Security restricting reads to the
Super Admin and to the Franchise Admin of the invitation's own outlet. No
client role SHALL be able to read the stored code hash by any means, including
an explicit request for that column. No client role SHALL be able to insert,
update, or delete an invitation; those writes SHALL only be possible with the
service-role credential inside a privileged server-side function.

#### Scenario: A Franchise Admin cannot see another outlet's invitations

- **WHEN** a Franchise Admin scoped to one outlet requests invitations,
  including with an explicit filter naming the other outlet
- **THEN** no rows from the other outlet are returned

#### Scenario: The code hash is unreadable even by the Super Admin

- **WHEN** any signed-in session requests the stored code hash column
- **THEN** the request is refused by the database

#### Scenario: No client can write an invitation

- **WHEN** any signed-in session attempts to insert, update, or delete an
  invitation row directly
- **THEN** the database refuses the write

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
