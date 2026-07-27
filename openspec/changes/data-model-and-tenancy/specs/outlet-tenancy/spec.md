# Outlet Tenancy — delta for `data-model-and-tenancy`

## ADDED Requirements

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
