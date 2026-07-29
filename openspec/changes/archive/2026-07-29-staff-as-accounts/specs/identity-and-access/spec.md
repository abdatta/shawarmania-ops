# identity-and-access — delta for staff-as-accounts

## ADDED Requirements

### Requirement: A person is created once, as an account

Creating a staff member SHALL be one act on one surface: the admin supplies
the person's name, address, phone, role, outlet, and optionally a job title
and joining date, and the result is a single record that is simultaneously
their login and their staff-list membership. No separate roster write, link
step, or second surface SHALL exist anywhere in the UI.

Staff facts (`staff_code`, `role_title`, `joined_on`, `left_on`) live on the
account record itself. Editing them SHALL be done by the admin's own session
under Row-Level Security — a Super Admin for any account, a Franchise Admin
for accounts at their own outlet — while identity and access fields (role,
outlet, active state, email) remain writable only through the privileged
function that re-derives authority from the caller's token.

#### Scenario: One step creates a working person

- **WHEN** an admin creates a person in the Employee role with a name,
  address, and job title
- **THEN** one create action yields an account with an issued staff code and
  a one-time activation code, the person appears on the staff list
  immediately, and no linking step exists or is needed before they can check
  in once activated

#### Scenario: Staff facts are edited under Row-Level Security

- **WHEN** a Franchise Admin edits the job title or joining date of a person
  at their own outlet
- **THEN** the write succeeds as the admin's own session, and the same write
  against a person at another outlet is refused by the database

#### Scenario: Access fields stay out of the client's reach

- **WHEN** any client session attempts to write role, outlet, or active state
  directly on an account record
- **THEN** the database refuses the write; those fields change only through
  the privileged function

### Requirement: An account with recorded history cannot be deleted

The database SHALL refuse to delete an account that any recorded row refers
to — attendance, overrides it approved, entries it recorded, or any future
history table — and the refusal SHALL hold for every path, including a delete
issued at the auth layer that would cascade onto the account record. The set
of blocking references SHALL be derived from the catalog, not maintained as a
hand-kept list, so new history tables are covered when created.

An account with no recorded history SHALL remain deletable by the privileged
machinery, so that a provisioning that fails halfway can clean up after
itself.

Ending a person's involvement is expressed by deactivation or departure,
never deletion.

#### Scenario: Deleting an account with attendance is refused

- **WHEN** a hand-crafted request deletes an account that has recorded
  attendance, whether aimed at the account record or at the auth user above
  it
- **THEN** the database refuses, the statement aborts, and every row survives

#### Scenario: A freshly created account can still be cleaned up

- **WHEN** provisioning creates an account and a later step fails before any
  history exists
- **THEN** the cleanup delete succeeds

### Requirement: Departure and access are two independent facts

The people model SHALL keep whether an account may sign in (`is_active`) and
whether the person still works here (`left_on`) as two columns with no
database coupling, because one bit cannot express "access cut but still
employed" — the state the emergency lever produces.

Deactivating an account SHALL end its open session immediately and SHALL NOT
remove the person from the staff list or the day's attendance surface.
Marking a person departed SHALL remove them from staff lists while leaving
every recorded row in place. The departure flow SHALL offer deactivation in
the same confirmation, so the common case lands in both states in one act.

#### Scenario: The panic button does not falsify the day

- **WHEN** an admin deactivates the account of someone currently at work
- **THEN** the account's session ends immediately, and the person remains on
  the staff list and the day's attendance surface

#### Scenario: A departed person leaves the lists, not the record

- **WHEN** an admin marks a person as having left
- **THEN** they no longer appear on the staff list or new attendance days,
  and every attendance row and recorded action of theirs remains readable

#### Scenario: Departing offers the access cut

- **WHEN** an admin opens the departure confirmation
- **THEN** it offers to also deactivate the account, pre-selected, and
  confirms both consequences in one act

### Requirement: The people model carries no payroll data

No salary, wage, address-for-payroll, or other payroll field SHALL exist in
the schema or the UI. Attendance is recorded because it feeds payroll done
outside the app; the money itself SHALL be recordable only as an ordinary
expense when the owner wants it in the books.

#### Scenario: No payroll columns anywhere

- **WHEN** the schema and every people surface are inspected
- **THEN** no salary or payroll field exists on any table or form

### Requirement: A placeholder address is visible, not silent

An account whose address is a migration placeholder SHALL be visibly marked
on the People surface as needing a real address — a placeholder being one
that cannot receive anything — and the fix SHALL be the existing
address-correction path followed by issuing a code. Nothing SHALL send
anything to a placeholder address, because no code exists for such an
account until an admin has replaced it.

#### Scenario: A migrated person's address asks to be fixed

- **WHEN** the People surface lists an account carrying a placeholder address
- **THEN** the row is marked as needing an address before the person can be
  invited, and correcting it then issuing a code makes the account usable

## MODIFIED Requirements

### Requirement: A staff code is never blank

A person record that carries a staff code SHALL carry a non-empty one,
enforced by the database and not only by a form. A code consisting of
whitespace SHALL be refused, because a staff code identifies a person's
records for years and a blank one identifies nothing. Accounts that are not
outlet staff — the Super Admin, counter devices — carry no code at all, which
is absence, not blankness.

Absence and blankness are answered differently depending on the write. On
insert of a staff account, a missing or blank code is a request for one to be
issued, and the database SHALL fill it. On update, a blank or cleared code is
a mistake rather than a request — the record already has a code — and the
database SHALL refuse it rather than silently substituting one, so that
clearing the field never quietly becomes renaming it.

#### Scenario: A blank staff code on insert is filled, not refused

- **WHEN** a staff account is created with no staff code, or one that is
  entirely whitespace
- **THEN** the write succeeds and the record carries an issued code

#### Scenario: Blanking an existing staff code is refused

- **WHEN** any caller updates a person's staff code to empty, whitespace, or
  null
- **THEN** the database refuses the write

### Requirement: Every people surface answers whether a person can check in

The People surface SHALL show, for each person, whether they can check in,
and where they cannot, the reason SHALL be readable on the screen — the
account is deactivated, the person has left, or the account has never been
activated (no usable address yet, or an invite still outstanding) — so that
the question is answerable during a phone call without anyone opening the
database.

#### Scenario: A deactivated person reads as such

- **WHEN** the People surface lists a person whose account is deactivated
- **THEN** the row states the account is deactivated and cannot sign in or
  check in

#### Scenario: An unactivated person shows what is missing

- **WHEN** the People surface lists a person who has never activated — a
  placeholder address or an outstanding invite
- **THEN** the row states what is missing and the next step, not merely that
  something is wrong

#### Scenario: A working person reads as working

- **WHEN** the People surface lists an active, activated person
- **THEN** nothing on the row suggests a problem

### Requirement: A staff code is issued by the system, not invented by an admin

No surface SHALL require a person to supply a staff code in order to create a
staff account. When a staff account is created without one, the database
SHALL issue it, so that a staff account can never exist without a code and no
human is ever asked for a value the system can determine.

An issued code SHALL be short and readable, because it is displayed beside a
person's name on the staff list and on the attendance day — its only job is
to tell two people with the same name apart. It SHALL be the outlet's own
prefix followed by a short random suffix.

The suffix SHALL be drawn from an alphabet with no visually confusable
characters, because these codes are read aloud across a counter and dictated
over a phone. The alphabet already used for one-time codes SHALL be reused
rather than a second one invented.

Issuing SHALL be random rather than sequential, so that no value must be read
before one is written and two staff accounts created at one outlet at the
same moment cannot contend. The database SHALL retry a bounded number of
times if a generated code is already taken at that outlet, and SHALL raise a
clear error rather than looping if every attempt is exhausted.

A code supplied explicitly SHALL be honoured rather than replaced, so that
importing or setting a code by hand remains possible.

#### Scenario: Creating a person asks for no code

- **WHEN** an admin creates a staff account
- **THEN** no staff code is requested, and the account that results carries
  one

#### Scenario: The issued code names its outlet

- **WHEN** a staff account is created at an outlet
- **THEN** the issued code begins with that outlet's prefix, and its suffix
  contains no character that could be misread for another

#### Scenario: An explicitly supplied code is kept

- **WHEN** a staff account is created with a staff code supplied
- **THEN** that code is stored unchanged and no code is issued in its place

#### Scenario: Two people added at once get different codes

- **WHEN** two staff accounts are created at the same outlet concurrently,
  neither supplying a code
- **THEN** both succeed and the two codes differ

#### Scenario: A code already taken at that outlet is not issued twice

- **WHEN** issuing generates a code that a staff account at the same outlet
  already carries
- **THEN** another is generated instead, and the insert succeeds

### Requirement: An outlet's staff-code prefix is unique and fixed once used

Every outlet SHALL carry a short staff-code prefix, unique across all
outlets, because a prefix truncated from an outlet's name can collide — a
future Kalimpong would otherwise share Kalyani's. The database SHALL refuse a
prefix another outlet already holds.

The prefix SHALL be proposed automatically when an outlet is created, and
SHALL remain correctable while no staff code has been issued at that outlet.
Once any staff code has been issued at an outlet, its prefix SHALL be fixed,
because every code already issued reads from it and changing it would leave
those codes naming an outlet prefix that no longer exists.

#### Scenario: A new outlet is proposed a prefix

- **WHEN** an admin creates an outlet
- **THEN** a prefix is proposed from the outlet's own code, shown on the
  form, and stored with the outlet

#### Scenario: A prefix another outlet holds is refused

- **WHEN** an outlet is created or edited with a staff-code prefix that
  another outlet already carries
- **THEN** the database refuses the write and the surface says the prefix is
  taken

#### Scenario: The prefix is correctable before any code is issued

- **WHEN** an admin changes the staff-code prefix of an outlet where no
  staff code has been issued
- **THEN** the change is accepted

#### Scenario: The prefix is fixed once a staff code exists

- **WHEN** an admin attempts to change the staff-code prefix of an outlet
  where at least one staff account carries a code
- **THEN** the database refuses the change, and the surface explains that
  codes have already been issued from it

### Requirement: Only the owner changes a staff code, and the database is the boundary

A staff code SHALL be changeable after it is issued, and only by a Super
Admin. A Franchise Admin SHALL be able to edit every other staff fact on an
account they manage and SHALL NOT be able to change its staff code. The
refusal SHALL be made by the database, not only by the form, because staff
facts are written by the admin's own session under Row-Level Security and a
policy that permits the row permits every column on it.

The surface SHALL reflect this: the field is editable for a Super Admin and
inert for anyone else, so the refusal is not discovered by attempting it.

#### Scenario: A Franchise Admin cannot change a staff code

- **WHEN** a Franchise Admin attempts to change the staff code on an account
  in their own outlet, by any path including a hand-crafted request
- **THEN** the database refuses the write, and the record keeps its code

#### Scenario: A Franchise Admin still edits the rest of the record

- **WHEN** a Franchise Admin changes a person's name, job title, joining
  date or departure date
- **THEN** the write succeeds

#### Scenario: The owner changes a staff code

- **WHEN** a Super Admin sets a new staff code on a staff account
- **THEN** the write succeeds and the People surface shows the new code

### Requirement: A person's name is never blank

A person's account SHALL carry a non-empty full name, enforced by the
database and not only by a form. A name consisting entirely of whitespace
SHALL be refused.

A name is the only field on the record that a human reads to know who the
record is about. A staff code disambiguates two people with the same name; it
does not identify a person with no name at all. The same reasoning that made a
blank staff code unacceptable applies with more force to the name beside it.

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

### Requirement: An app account and a roster row are linked from either screen

**Reason**: Staff exist only as accounts; there is no roster row to link and
no link to store. The same-outlet and one-account-one-person invariants the
link enforced are now structural — one record cannot disagree with itself.

**Migration**: Existing `employees.profile_id` links are collapsed by the
migration: linked roster rows fold their staff facts onto the account;
attendance re-attaches to the account id.

### Requirement: Provisioning an Employee offers the roster and never assumes it

**Reason**: Having a login and being on the staff list are no longer
different facts — the owner removed the assumption (no payroll data in the
app, everyone gets an account). Creation is one act with no roster choice,
and the two-write partial-failure state cannot exist.

**Migration**: The People surface creates the person once. Accounts that
existed without roster rows simply are staff; roster rows without accounts
get one auto-provisioned by the migration with a placeholder address.

### Requirement: Unlinking is reversible and never erases worked days

**Reason**: There is no link to remove. The duty this requirement protected —
worked days are never erased by an identity change — is carried forward by
"Departure and access are two independent facts" and "An account with
recorded history cannot be deleted".

**Migration**: None; the unlink control disappears with the link.
