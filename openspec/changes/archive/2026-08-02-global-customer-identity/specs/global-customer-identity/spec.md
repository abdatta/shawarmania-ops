## ADDED Requirements

### Requirement: One canonical phone identifies one global customer

Every customer SHALL have one non-null canonical Indian phone that is unique
across the business. Accepted presentation variants SHALL normalize to the same
`+91` identity; incomplete or invalid input SHALL create and match nothing.

#### Scenario: Equivalent phone formats
- **WHEN** `98765 43210`, `919876543210`, and `+91-98765-43210` are normalized
- **THEN** each resolves to the same canonical phone and customer identity

#### Scenario: Invalid phone
- **WHEN** billing submits an incomplete or structurally invalid phone
- **THEN** no lookup or customer creation occurs and the form names the validation problem

### Requirement: Billing contexts lookup only by complete exact phone

An active registered device with a live billing grant SHALL retrieve a customer
only by submitting the complete phone. The response SHALL contain only customer
ID, canonical phone, and saved billing name. No outlet role or device SHALL have
a browse, prefix, fuzzy, aggregate, or direct-table read path.

#### Scenario: Exact returning-customer lookup
- **WHEN** an eligible billing context supplies a complete phone that exists
- **THEN** the one global profile is returned without any bill, outlet, spend, or visit information

#### Scenario: Prefix enumeration attempt
- **WHEN** a device supplies a prefix, wildcard, or list request
- **THEN** the request returns no directory rows and discloses no matching count

#### Scenario: Franchise Admin hand-crafts direct SELECT
- **WHEN** an FA uses their valid personal token to query the customer table
- **THEN** the database returns no customer rows

### Requirement: Exact lookup is rate bounded without logging phone PII

The server SHALL bound repeated lookup attempts per device/caller over a rolling
window. Attempt telemetry SHALL NOT store raw or reversibly encoded phone input.

#### Scenario: Device exceeds the lookup bound
- **WHEN** one device exceeds the permitted exact lookups in the window
- **THEN** further lookups are temporarily refused without examining or exposing a customer

### Requirement: A new billing phone is created automatically and never overwrites an existing profile

The system SHALL, when an accepted order or paid command supplies a valid phone
with no match, create the global customer automatically using the optional form
name. If the phone already exists, the command SHALL reuse its ID and SHALL NOT
change saved profile values, even when the bill snapshot differs.

#### Scenario: First transaction for a phone
- **WHEN** an accepted billing command contains a valid phone not yet stored
- **THEN** one global profile is created and linked to that transaction

#### Scenario: Concurrent first use
- **WHEN** concurrent valid commands first use the same canonical phone
- **THEN** one customer row exists and both transactions reference it

#### Scenario: Existing profile has another name
- **WHEN** a transaction uses an existing phone with a different form name
- **THEN** its bill snapshots the form name while the saved global profile remains unchanged

### Requirement: Customer identity never widens transaction access

Orders, bills, payments, and histories SHALL remain governed by their own
outlet scope. Knowing or retrieving a global customer ID SHALL confer no access
to that customer's transactions at another outlet.

#### Scenario: Known global ID is used across the boundary
- **WHEN** an outlet session hand-crafts a bill/history request using a customer ID also used elsewhere
- **THEN** only transactions already readable at that outlet can be returned

### Requirement: Super Admin access uses a separate owner boundary

An active SA SHALL be permitted to read the global customer directory through
an owner-authorized management path. This SHALL NOT grant FA, Biller, Employee,
or device sessions the same access, and no profile-editing UI SHALL ship here.

#### Scenario: Owner reads the directory
- **WHEN** an active SA uses the customer management read path
- **THEN** global profiles are available without exposing credentials or bypassing bill RLS

#### Scenario: Outlet role calls the owner path
- **WHEN** an FA, Biller, Employee, or machine principal calls that path
- **THEN** the request is refused

### Requirement: Migration never guesses between conflicting identities

Existing rows that normalize to one phone SHALL merge only when their nonblank
profile facts are equivalent. Invalid phones or conflicting nonblank names SHALL
abort migration before destructive change, and diagnostics SHALL contain counts
but no phone numbers or names.

#### Scenario: Equivalent synthetic duplicates
- **WHEN** two outlet rows normalize to one phone and have equivalent names
- **THEN** references are rewired to one retained UUID before outlet scope is removed

#### Scenario: Conflicting duplicate
- **WHEN** two rows normalize to one phone but carry conflicting nonblank names
- **THEN** migration stops without dropping either row or printing their PII
