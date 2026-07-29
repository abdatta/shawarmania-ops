# identity-and-access — delta for multi-outlet-people

## ADDED Requirements

### Requirement: One person has one login, however many outlets they work at

A person SHALL have exactly one account regardless of how many outlets they
work at or how many roles they hold. No surface, function, or migration SHALL
create a second login for a second outlet.

Where a person works, and as what, SHALL be an explicit assignment per outlet.
Holding a role at one outlet SHALL confer nothing at any other outlet.

#### Scenario: A person working at two outlets signs in once

- **WHEN** a person assigned to two outlets signs in
- **THEN** one account and one password serve both, and nothing asks them to
  choose, switch, or identify which outlet they are for

#### Scenario: A role at one outlet confers nothing at another

- **WHEN** a person who is a Franchise Admin at one outlet and an Employee at
  another attempts a manager write at the outlet where they are an Employee
- **THEN** the database refuses it

### Requirement: Assignments are managed on the People surface

An admin SHALL be able to grant a person an assignment at an outlet, and to end
one, from the People surface — a Super Admin for any outlet, a Franchise Admin
only for outlets they manage and only for Biller and Employee assignments.
The surface SHALL show every person's live assignments, each naming its outlet
and role.

Ending a person's last live assignment SHALL offer to deactivate the account in
the same confirmation, and SHALL state that ending an assignment removes them
from that outlet's lists while leaving every recorded row in place.

#### Scenario: A person is assigned to a second outlet

- **WHEN** an admin grants an existing person an assignment at a second outlet
- **THEN** the person appears on that outlet's staff list, may check in there,
  and keeps everything they had at the first outlet

#### Scenario: A manager cannot assign beyond their authority

- **WHEN** a Franchise Admin opens the assignment control
- **THEN** only outlets they manage are offered, only Biller and Employee roles
  are offered, and the database refuses anything else regardless of the request

#### Scenario: Ending one assignment leaves the person working elsewhere

- **WHEN** an admin ends a person's assignment at one of the two outlets they
  work at
- **THEN** that outlet's staff list no longer shows them, the other outlet's
  still does, their account still signs in, and every attendance row at both
  outlets remains

#### Scenario: Ending the last assignment offers the access cut

- **WHEN** an admin ends a person's only remaining assignment
- **THEN** the confirmation offers to deactivate the account as well, and
  states that recorded rows are unaffected either way

### Requirement: The owner records non-cash entries at any outlet, and never cash

A Super Admin SHALL be able to record a non-cash expense and an inventory
correction at any outlet without being assigned to it. Every such row SHALL
carry the owner as the recording person and SHALL be shown as the owner's
wherever it is read.

The database SHALL refuse a cash expense, a cash withdrawal, and a day close
from this path, so that nothing touching a drawer can be recorded remotely. The
drawer SHALL remain the responsibility of the person assigned as that outlet's
Franchise Admin.

A Super Admin who additionally holds a Franchise Admin assignment at an outlet
SHALL be able to perform that outlet's full operational writes there — cash
included — and at no other outlet, because that authority comes from the
assignment rather than from being the owner.

#### Scenario: The owner records a non-cash expense remotely

- **WHEN** a Super Admin records an expense paid by UPI at an outlet they hold
  no assignment at
- **THEN** the expense is recorded, attributed to them, and reads as the
  owner's entry on that outlet's expenses surface

#### Scenario: The owner records a stock correction remotely

- **WHEN** a Super Admin records an inventory correction with a note at an
  outlet they hold no assignment at
- **THEN** the movement is recorded, attributed to them, and the item's
  quantity moves by exactly that correction

#### Scenario: Cash from the remote path is refused by the database

- **WHEN** a Super Admin holding no assignment at an outlet attempts, by any
  path including a hand-crafted request, to record a cash expense, a cash
  withdrawal, or a day close at that outlet
- **THEN** the database refuses the write

#### Scenario: The owner assigned as a manager runs that outlet

- **WHEN** a Super Admin who also holds a Franchise Admin assignment at one
  outlet closes that outlet's business day
- **THEN** the close succeeds, and the same close attempted at an outlet they
  hold no assignment at is refused

## RENAMED Requirements

- FROM: `### Requirement: Each role lands on its own shell`
- TO: `### Requirement: Each role lands on a shell it holds an assignment for`

- FROM: `### Requirement: A role or outlet reassignment ends the open session`
- TO: `### Requirement: An assignment change takes effect without ending the session`

## MODIFIED Requirements

### Requirement: Each role lands on a shell it holds an assignment for

After sign-in a session SHALL be routed to the shell of the highest role it
holds a live assignment for. A session SHALL be able to reach any role shell it
holds a live assignment for, and SHALL NOT be able to render one it does not —
navigating there SHALL redirect it home.

Navigation SHALL be the union of the surfaces every live assignment entitles
the person to, so that a person who manages one outlet and works at another
reaches both sets of surfaces without switching anything.

#### Scenario: All four roles reach their own shell

- **WHEN** a Super Admin, a Franchise Admin, a Biller, and an Employee each
  sign in
- **THEN** each lands on their own role's home surface with that role's
  navigation

#### Scenario: A mixed-role person sees both sets of surfaces

- **WHEN** a person holding a Franchise Admin assignment at one outlet and an
  Employee assignment at another signs in
- **THEN** they land on the Franchise Admin shell and their navigation includes
  their own attendance alongside the manager surfaces, with no switcher

#### Scenario: A path for an unheld role redirects

- **WHEN** a signed-in session navigates to the path of a role it holds no live
  assignment for
- **THEN** it is redirected to its own home rather than rendering that shell

#### Scenario: A signed-in visit to the landing page goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to its own home rather than shown the unauthenticated
  landing page

### Requirement: An assignment change takes effect without ending the session

An assignment granted or ended while a person's app is open SHALL take effect
at the database immediately, and the open client SHALL reflect it within a
bounded interval without the person signing in again — because nothing about
authority is carried in the token, there is nothing to reissue.

A client SHALL NOT render a shell or a surface for a role it holds no live
assignment for. A person who loses every live assignment SHALL be returned to a
state that offers no outlet surfaces and states why.

#### Scenario: A new assignment appears without signing out

- **WHEN** a person is granted an assignment at a second outlet while their app
  is open
- **THEN** the second outlet becomes available to them within the revalidation
  interval, with no sign-out and no password re-entry

#### Scenario: An ended assignment stops rendering its shell

- **WHEN** the assignment behind the shell a person is currently viewing is
  ended
- **THEN** the client stops rendering that shell within the revalidation
  interval, and the database refuses its writes immediately regardless

#### Scenario: Losing every assignment is stated, not a blank screen

- **WHEN** a person's last live assignment is ended while their app is open
- **THEN** they are shown that they are not currently assigned to any outlet,
  rather than an empty shell

#### Scenario: Reassignment invalidates outstanding codes

- **WHEN** a person's assignments change while an unredeemed code exists for
  them
- **THEN** that code is no longer redeemable

### Requirement: Provisioning authority is re-derived from the caller's token

A privileged account function SHALL determine the caller's assignments from the
caller's own verified session, never from values supplied in the request. A
Super Admin MAY provision, re-issue, and deactivate any account other than
their own. A Franchise Admin MAY do so only for Biller and Employee accounts at
outlets they hold a live Franchise Admin assignment at, and only where every
outlet the target person is assigned to is one they manage. Every other
combination SHALL be refused.

#### Scenario: A Franchise Admin cannot provision outside their outlets

- **WHEN** a Franchise Admin requests an account at an outlet they hold no live
  assignment at
- **THEN** the request is refused and no account is created

#### Scenario: A Franchise Admin cannot create an administrator

- **WHEN** a Franchise Admin requests a Super Admin or Franchise Admin account
- **THEN** the request is refused and no account is created

#### Scenario: A Franchise Admin cannot manage a person who also works elsewhere

- **WHEN** a Franchise Admin attempts to deactivate or re-issue a code for a
  person who also holds a live assignment at an outlet they do not manage
- **THEN** the request is refused, because the account is not theirs alone to
  act on

#### Scenario: A Biller or Employee cannot provision at all

- **WHEN** a Biller or an Employee calls a privileged account function
- **THEN** the request is refused

#### Scenario: An admin cannot deactivate themselves

- **WHEN** an admin requests deactivation of their own account
- **THEN** the request is refused and the account stays active

### Requirement: A person is created once, as an account

Creating a staff member SHALL be one act on one surface: the admin supplies the
person's name, address, phone, role, outlet, and optionally a job title, and
the result is a single record that is simultaneously their login and their
staff-list membership, together with the assignment that places them. No
separate roster write, link step, or second surface SHALL exist anywhere in the
UI.

The person's job title (`role_title`) lives on the account record; where they
work and from when lives on the assignment. Editing the job title SHALL be done
by the admin's own session under Row-Level Security — a Super Admin for any
account, a Franchise Admin for people assigned to an outlet they manage — while
identity and access fields (active state, email) and assignments themselves
remain governed by their own boundaries.

#### Scenario: One step creates a working person

- **WHEN** an admin creates a person in the Employee role at an outlet with a
  name, address, and job title
- **THEN** one create action yields an account, a live assignment at that
  outlet, and a one-time activation code; the person appears on that outlet's
  staff list immediately, and no linking step exists or is needed before they
  can check in once activated

#### Scenario: Staff facts are edited under Row-Level Security

- **WHEN** a Franchise Admin edits the job title of a person assigned to their
  own outlet
- **THEN** the write succeeds as the admin's own session, and the same write
  against a person assigned only to another outlet is refused by the database

#### Scenario: Access fields stay out of the client's reach

- **WHEN** any client session attempts to write the active state directly on an
  account record
- **THEN** the database refuses the write; that field changes only through the
  privileged function

### Requirement: Departure and access are two independent facts

The people model SHALL keep whether an account may sign in (`is_active`) and
where the person still works (their live assignments) as independent facts with
no database coupling, because one bit cannot express "access cut but still
employed" — the state the emergency lever produces.

Deactivating an account SHALL end its open session immediately and SHALL NOT
end any assignment, remove the person from any staff list, or remove them from
the day's attendance surface. Ending an assignment SHALL remove the person from
that outlet's staff list and its new attendance days while leaving every
recorded row in place, and SHALL leave their account and their other
assignments untouched.

A person has left the business when they hold no live assignment at all; that
state SHALL be derived rather than stored as a separate column.

#### Scenario: The panic button does not falsify the day

- **WHEN** an admin deactivates the account of someone currently at work
- **THEN** the account's session ends immediately, and the person remains on
  every staff list they were on and on the day's attendance surface

#### Scenario: A departed person leaves the lists, not the record

- **WHEN** an admin ends every live assignment a person holds
- **THEN** they no longer appear on any staff list or new attendance day, and
  every attendance row and recorded action of theirs remains readable

#### Scenario: Departure from one outlet is not departure from the business

- **WHEN** an admin ends one of a person's two assignments
- **THEN** the person is still current staff at the other outlet and is not
  shown as having left

### Requirement: Every people surface answers whether a person can check in

The People surface SHALL show, for each person, whether they can check in and
where, and where they cannot, the reason SHALL be readable on the screen — the
account is deactivated, the person holds no live assignment, or the account has
never been activated (no usable address yet, or an invite still outstanding) —
so that the question is answerable during a phone call without anyone opening
the database.

#### Scenario: A deactivated person reads as such

- **WHEN** the People surface lists a person whose account is deactivated
- **THEN** the row states the account is deactivated and cannot sign in or
  check in

#### Scenario: An unactivated person shows what is missing

- **WHEN** the People surface lists a person who has never activated — a
  placeholder address or an outstanding invite
- **THEN** the row states what is missing and the next step, not merely that
  something is wrong

#### Scenario: A person with no assignment reads as unplaced

- **WHEN** the People surface lists an active, activated person holding no live
  assignment
- **THEN** the row states that they are not assigned to any outlet and cannot
  check in anywhere

#### Scenario: A working person reads as working

- **WHEN** the People surface lists an active, activated person with at least
  one live assignment
- **THEN** nothing on the row suggests a problem, and every outlet they are
  assigned to is named

### Requirement: A person's name is never blank

A person's account SHALL carry a non-empty full name, enforced by the
database and not only by a form. A name consisting entirely of whitespace
SHALL be refused.

A name is the only field on the record that a human reads to know who the
record is about — and since staff codes retired it is the only one at all.
Two people with the same name are told apart by their job title and where
they work; neither identifies a person with no name.

The surface that writes the record SHALL refuse before writing and SHALL name
the field that is missing, on the People surface's create and edit paths
alike.

#### Scenario: A person cannot be created without a name

- **WHEN** an admin submits the People form with the full name empty or
  containing only spaces
- **THEN** no account is created, no one-time code is issued, and the form says
  which field is missing

#### Scenario: The database refuses a blank name whatever the client sends

- **WHEN** any caller inserts or updates a profile whose full name is empty or
  entirely whitespace, including by a request that bypasses the form
- **THEN** the database refuses the write

#### Scenario: An existing person cannot be edited into a nameless one

- **WHEN** an admin edits a person and clears the full name
- **THEN** the write is refused and the row keeps the name it had

## REMOVED Requirements

### Requirement: A staff code is never blank

**Reason**: Staff codes retire entirely (owner decision, 2026-07-29). Their only
recorded job was telling two same-named people apart in lists, and role title
plus joining date do that without a second identifier for anybody to maintain,
read aloud, or get wrong.

**Migration**: `profiles.staff_code` and its unique and not-blank constraints
are dropped. One-time activation codes are unrelated and unaffected.

### Requirement: A staff code is issued by the system, not invented by an admin

**Reason**: Retired with the staff code itself.

**Migration**: `issue_staff_code()`, `random_staff_suffix()` and the
`profiles_issue_code` trigger are dropped.

### Requirement: An outlet's staff-code prefix is unique and fixed once used

**Reason**: Retired with the staff code itself; a prefix with no codes beneath
it names nothing.

**Migration**: `outlets.staff_code_prefix`, its unique and shape constraints,
`derive_staff_code_prefix()`, the prefix-defaulting trigger and
`outlet_prefix_guard()` are dropped, along with the field on the outlet form.

### Requirement: Only the owner changes a staff code, and the database is the boundary

**Reason**: Retired with the staff code itself.

**Migration**: `staff_code_guard()` and the `profiles_code_guarded` trigger are
dropped.
