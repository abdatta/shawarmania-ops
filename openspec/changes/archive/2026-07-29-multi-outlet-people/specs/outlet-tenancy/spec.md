# outlet-tenancy — delta for multi-outlet-people

## ADDED Requirements

### Requirement: Authority is an assignment, resolved by the database on every request

A person's authority SHALL be expressed as a set of **assignments**, each
naming a person, a role, and an outlet — with the outlet absent exactly for
the business-wide Super Admin role. Row-Level Security policies SHALL resolve
scope by asking whether the requesting person holds a live assignment in the
required role at the row's outlet.

Nothing about what a person may do SHALL be carried in their access token.
Consequently an assignment that is granted or ended SHALL take effect at the
next request, with no token reissue, refresh, or sign-out required.

An assignment SHALL be ended by recording an end date, never by deleting the
record, so that rows written under it remain explicable.

At most one live assignment SHALL exist per person per outlet, and at most one
live Super Admin assignment per person, enforced by the database.

#### Scenario: A person holds authority at two outlets

- **WHEN** a person holds a live assignment at each of two outlets and reads an
  outlet-scoped table
- **THEN** rows from both of their outlets are returned, and rows from any
  outlet they hold no live assignment at are not

#### Scenario: A granted assignment takes effect without a new token

- **WHEN** a person is granted an assignment at an outlet while their app is
  open, and a request is made on the token they already hold
- **THEN** the request is served under the new assignment, because the policy
  read the assignment rather than the token

#### Scenario: An ended assignment stops working immediately

- **WHEN** a person's assignment at an outlet is ended and a request naming
  that outlet is made with their still-valid token
- **THEN** the database returns no rows and accepts no writes for that outlet

#### Scenario: Ending one assignment leaves the others alone

- **WHEN** a person assigned to two outlets has one assignment ended
- **THEN** their other assignment still works, their account still signs in,
  and every row either assignment produced remains

#### Scenario: An ended assignment is retained, not deleted

- **WHEN** an assignment is ended
- **THEN** the record remains with its end date recorded, and no client role
  can delete it

### Requirement: A person's own assignments cannot grant them the owner role

No caller SHALL be able to grant themselves a Super Admin assignment, by any
path including a hand-crafted request. A Super Admin MAY grant themselves an
outlet-scoped assignment, because it confers authority over an outlet they
already oversee; no other role MAY grant themselves any assignment at all.

The last live Super Admin assignment SHALL NOT be endable, by anyone including
its holder, so that the business cannot be left with no owner.

#### Scenario: Self-granting the owner role is refused

- **WHEN** any caller, including a Super Admin, attempts to insert a Super
  Admin assignment for themselves
- **THEN** the database refuses the write

#### Scenario: The owner assigns themselves to an outlet

- **WHEN** a Super Admin grants themselves a Franchise Admin assignment at an
  outlet
- **THEN** the write succeeds, and they may thereafter perform that outlet's
  operational writes at that outlet and at no other

#### Scenario: A manager cannot assign themselves anywhere

- **WHEN** a Franchise Admin, Biller, or Employee attempts to insert any
  assignment for themselves
- **THEN** the database refuses the write

#### Scenario: The last owner cannot be removed

- **WHEN** an attempt is made to end the only live Super Admin assignment
- **THEN** the database refuses, and the assignment remains live

### Requirement: Assignments are covered by the isolation suite

The `assignments` table SHALL carry Row-Level Security and SHALL appear in the
isolation coverage enumeration like every other table. A Franchise Admin SHALL
read the assignments of people at outlets they manage and no others, and SHALL
NOT be able to write an assignment naming an outlet they do not manage.

#### Scenario: A manager reads only their own outlets' assignments

- **WHEN** a Franchise Admin lists assignments, including with an explicit
  filter naming another outlet
- **THEN** only assignments at outlets they manage are returned

#### Scenario: A manager cannot assign into another outlet

- **WHEN** a Franchise Admin attempts to insert an assignment naming an outlet
  they do not manage
- **THEN** the database refuses the write

## RENAMED Requirements

- FROM: `### Requirement: Account invitations are outlet-scoped and their codes are unreadable`
- TO: `### Requirement: Account invitations are scoped to who may manage the person, and their codes are unreadable`

## MODIFIED Requirements

### Requirement: Outlet isolation is enforced by the database on every outlet-scoped table

Every outlet-scoped table SHALL have Row-Level Security enabled with policies
that restrict reads and writes to the outlets the requesting person holds a
live assignment at. A Franchise Admin, Biller, or Employee session MUST NOT be
able to read or write the rows of an outlet they hold no live assignment at by
any means — including a hand-crafted API request that names another outlet's
identifier explicitly, with a valid session.

#### Scenario: Franchise Admin reads only their own outlet

- **WHEN** a Franchise Admin assigned to Kalyani alone lists rows of any outlet-scoped table
- **THEN** only Kalyani's rows are returned

#### Scenario: Hand-crafted read naming the other outlet

- **WHEN** the same session issues a request explicitly filtered to Kanchrapara's outlet id
- **THEN** zero rows are returned, because the database policy excludes them

#### Scenario: Hand-crafted write naming the other outlet

- **WHEN** a Franchise Admin, Biller, or Employee session attempts an insert or update carrying the `outlet_id` of an outlet they hold no live assignment at
- **THEN** the database rejects the write

#### Scenario: Super Admin reads across outlets

- **WHEN** a Super Admin session lists rows of an outlet-scoped table
- **THEN** rows from every outlet are returned

### Requirement: Seed data spans both outlets and contains no real people

Seed fixtures SHALL create both real outlets (Kalyani and Kanchrapara) with
their owner-confirmed business-day cutover and geofence radius, the real menu,
and only synthetic people with obviously fake contact details. Seeds MUST
produce at least two outlets, so isolation failures have something to fail
against. Seeds SHALL include at least one person holding live assignments at
both outlets, so that the multi-outlet path is exercised rather than assumed.

#### Scenario: Fresh database is seeded

- **WHEN** the local database is reset with seeds applied
- **THEN** both outlets exist with cutover 04:00 and geofence radius 150 m, the real menu is present, every person, phone number, and credential is synthetic, and at least one person is assigned to both outlets

### Requirement: Account invitations are scoped to who may manage the person, and their codes are unreadable

The record of an outstanding one-time code SHALL be readable only by the Super
Admin and by a Franchise Admin who manages an outlet where the invited person
holds a live assignment. No client role SHALL be able to read the stored code
hash by any means, including an explicit request for that column. No client
role SHALL be able to insert, update, or delete an invitation; those writes
SHALL only be possible with the service-role credential inside a privileged
server-side function.

#### Scenario: A Franchise Admin cannot see another outlet's invitations

- **WHEN** a Franchise Admin who manages one outlet requests invitations for a
  person assigned only to the other outlet, including with an explicit filter
- **THEN** no such rows are returned

#### Scenario: The code hash is unreadable even by the Super Admin

- **WHEN** any signed-in session requests the stored code hash column
- **THEN** the request is refused by the database

#### Scenario: No client can write an invitation

- **WHEN** any signed-in session attempts to insert, update, or delete an
  invitation row directly
- **THEN** the database refuses the write

## REMOVED Requirements

### Requirement: Session tokens carry role and outlet identity as claims

**Reason**: Superseded by assignment-resolved authority. A single role-and-outlet
pair in a token cannot express a person who works at two outlets, and baking
authority into a token means an assignment change waits for a token to be
reissued. Policies now read the `assignments` table through stable
security-definer helpers — which avoids the per-row profile lookup this
requirement existed to forbid, because the helpers are set-returning and hoist
to one lookup per query.

**Migration**: `app_role()` and `app_outlet_id()` are dropped and the hook is
unregistered from `supabase/config.toml`. Every policy that read the claims
reads membership instead. `custom_access_token_hook` itself is **emptied to a
no-op rather than dropped**: a deployed project registers its hook in its own
auth settings, and dropping the function while that registration stood would
fail every token issue and lock everybody out — including whoever would go and
turn it off. It injects nothing, so the requirement holds either way.
