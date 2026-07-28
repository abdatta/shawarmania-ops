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

### Requirement: An outlet's address can be filled from a search in one action

The outlet form SHALL offer a search that suggests real places and, when one is
picked, fills the address block in a single action — street line, second line,
city and PIN code together.

The search SHALL restrict its results to India. It SHALL be debounced, and a
response to a superseded query SHALL NOT replace the results of a later one.

Picking a suggestion SHALL write every address field, including clearing those
the suggestion does not carry, so the address is never a mixture of two places.
The outlet's location label SHALL be filled only when it is empty, and SHALL
NEVER be overwritten, because it is the owner's own wording rather than an
address component.

#### Scenario: Picking a place fills the address

- **WHEN** an admin searches for a place while creating an outlet and picks a
  suggestion
- **THEN** the street line, second line, city and PIN code are filled from it in
  one action

#### Scenario: A pick never leaves a mixture of two addresses

- **WHEN** an admin picks one suggestion and then picks a different one that
  carries no PIN code
- **THEN** the PIN code from the first is cleared rather than left beside the
  second's street

#### Scenario: A label the admin wrote is never overwritten

- **WHEN** an admin types a location label and then picks a suggestion
- **THEN** the label they typed is left exactly as it is

#### Scenario: An empty label is filled from the pick

- **WHEN** an admin picks a suggestion while the location label is still empty
- **THEN** the label is filled from the place that was picked

### Requirement: The district is derived from the PIN code, never from the map

The district SHALL be resolved from the PIN code through a postal directory,
and SHALL NOT be taken from the geocoding result — no field of which is the
Indian revenue district.

The resolution SHALL run both when a suggestion supplies a PIN code and when an
admin edits the PIN code by hand, so the district is filled for somebody who
never opens the search.

Resolving the district SHALL NOT delay the rest of the fill.

#### Scenario: The district follows a picked place

- **WHEN** an admin picks a suggestion carrying a PIN code
- **THEN** the address fields fill immediately and the district is filled from
  that PIN code once the directory answers

#### Scenario: Typing a PIN code alone fills the district

- **WHEN** an admin types a valid PIN code by hand without using the search
- **THEN** the district is filled from it

#### Scenario: A PIN code the directory does not know leaves the field alone

- **WHEN** the postal directory returns nothing for a PIN code
- **THEN** the district is left empty for the admin to type, and no error is
  shown

### Requirement: The address search never blocks creating an outlet

The lookup SHALL be optional to the operation in progress. A lookup that fails,
times out, is refused or is unreachable SHALL produce no error message, SHALL
leave every field editable, and SHALL leave the outlet creatable exactly as it
is without the lookup.

A search that completes with no matches SHALL say so, because silence is
indistinguishable from a search still running.

#### Scenario: An unreachable lookup changes nothing

- **WHEN** the address lookup cannot be reached
- **THEN** no error is shown, every address field remains editable, and the
  outlet can be created with a hand-typed address

#### Scenario: No matches is stated rather than left blank

- **WHEN** a search returns no results
- **THEN** the surface says there are no matches and points at the fields below

#### Scenario: Every filled field stays editable

- **WHEN** an admin picks a suggestion and then edits any filled field
- **THEN** the edit is kept and the outlet saves with the edited value

### Requirement: An address lookup never supplies an outlet's position

The address lookup SHALL NOT write `latitude`, `longitude`, `geofence_radius_m`
or the survey timestamp, and the coordinates returned by a geocoder SHALL be
discarded rather than carried through the application.

Capturing an outlet's position on site SHALL remain the only way an outlet
becomes surveyed.

#### Scenario: Picking a place leaves the outlet unsurveyed

- **WHEN** an admin creates an outlet, picks an address suggestion, and saves
- **THEN** the outlet has no captured position, judges nobody against a fence,
  and is still shown as unsurveyed

#### Scenario: Coordinates are not carried through the application

- **WHEN** a geocoding result carrying coordinates is turned into a suggestion
- **THEN** the suggestion has no latitude or longitude to read

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

### Requirement: An outlet that nothing references can be deleted, by the owner alone

A Super Admin SHALL be able to delete an outlet from the app, and no other role
SHALL be offered the action or permitted it. The database SHALL refuse the
delete for every other role regardless of what a client sends — a `DELETE`
grant and an `outlets_delete` policy are the boundary, not the absence of a
button.

Deletion SHALL succeed only while no row anywhere references the outlet. The
refusal SHALL be enforced by referential integrity rather than by a maintained
flag or a count kept in application code, so that an outlet becomes deletable
the moment the last thing referencing it is gone, with nothing to re-mark.

Deletion SHALL NOT cascade. No dependent row SHALL be removed, reassigned or
altered in order to make a delete succeed.

`outlets` is the only table any client role may delete from. This is a named
exception to the schema-wide rule that records are voided, deactivated or
corrected rather than removed — justified because an outlet nothing references
carries no history, and bounded to that table alone.

#### Scenario: The owner deletes an outlet nothing references

- **WHEN** a Super Admin deletes an outlet that no account, roster row, device,
  bill, stock item, expense or alert refers to
- **THEN** the outlet is removed and no longer appears on any surface

#### Scenario: A populated outlet cannot be deleted

- **WHEN** a Super Admin attempts to delete an outlet that anything still
  references
- **THEN** the database refuses the delete, and every referencing row is left
  exactly as it was

#### Scenario: No other role can delete an outlet

- **WHEN** a Franchise Admin, Biller or Employee session attempts to delete an
  outlet, including by a hand-crafted request naming its identifier
- **THEN** the database refuses the delete, and the action is offered nowhere
  in their app

#### Scenario: An emptied outlet becomes deletable on its own

- **WHEN** the last row referencing an outlet is removed or moved elsewhere
- **THEN** that outlet can be deleted, with nothing else to update first

### Requirement: An outlet is closed before it can be deleted, and the refusal says what is still attached

The delete action SHALL be offered only for an outlet that is already marked
closed. An active outlet SHALL NOT be deletable in a single step, so that the
reversible action always precedes the irreversible one.

Deletion SHALL be confirmed before it happens, and the confirmation SHALL state
what deletion does that closing does not — that the outlet is removed rather
than hidden, and that it cannot be undone.

When a delete is refused because the outlet is still referenced, the surface
SHALL name what is still attached and how much of it, rather than reporting a
database error or a constraint name. The set of things it looks for SHALL be
derived from the database's own foreign keys, so that a table added later is
included without anyone remembering to add it.

#### Scenario: An active outlet is not offered deletion

- **WHEN** a Super Admin views an outlet that is currently active
- **THEN** no delete action is available for it, and marking it closed is the
  step that reveals one

#### Scenario: Deletion is confirmed, and the confirmation distinguishes it from closing

- **WHEN** a Super Admin chooses to delete a closed outlet
- **THEN** a confirmation states that the outlet is removed rather than hidden
  and that this cannot be undone, and nothing is deleted until it is accepted

#### Scenario: A blocked delete names what is still attached

- **WHEN** a Super Admin attempts to delete a closed outlet that still has
  accounts and roster rows
- **THEN** the refusal names those things and their counts, in words rather
  than as a constraint name

#### Scenario: A table added later is included in the refusal

- **WHEN** a new table referencing outlets is added to the schema and an outlet
  carrying rows in it is deleted
- **THEN** the refusal accounts for that table without any change to the
  deletion surface

#### Scenario: A deactivated account still blocks deletion

- **WHEN** a Super Admin attempts to delete an outlet whose only remaining
  references are deactivated accounts
- **THEN** the delete is refused, because the rows still reference the outlet

