## ADDED Requirements

### Requirement: A staff code is issued by the system, not invented by an admin

No surface SHALL require a person to supply a staff code in order to put
somebody on the roster. When a roster row is created without one, the database
SHALL issue it, so that a roster row can never exist without a code and no
human is ever asked for a value the system can determine.

An issued code SHALL be short and readable, because it is displayed beside a
person's name on the staff list, on the attendance day, and in the
account-linking control — its only job is to tell two people with the same name
apart. It SHALL be the outlet's own prefix followed by a short random suffix.

The suffix SHALL be drawn from an alphabet with no visually confusable
characters, because these codes are read aloud across a counter and dictated
over a phone. The alphabet already used for one-time codes SHALL be reused
rather than a second one invented.

Issuing SHALL be random rather than sequential, so that no value must be read
before one is written and two roster rows created at one outlet at the same
moment cannot contend. The database SHALL retry a bounded number of times if a
generated code is already taken at that outlet, and SHALL raise a clear error
rather than looping if every attempt is exhausted.

A code supplied explicitly SHALL be honoured rather than replaced, so that
importing or setting a code by hand remains possible.

#### Scenario: Adding someone to the roster asks for no code

- **WHEN** an admin adds a person to the staff list, from the Staff surface or
  while provisioning an Employee account
- **THEN** no staff code is requested, and the roster row that results carries
  one

#### Scenario: The issued code names its outlet

- **WHEN** a roster row is created at an outlet
- **THEN** the issued code begins with that outlet's prefix, and its suffix
  contains no character that could be misread for another

#### Scenario: An explicitly supplied code is kept

- **WHEN** a roster row is inserted with a staff code supplied
- **THEN** that code is stored unchanged and no code is issued in its place

#### Scenario: Two people added at once get different codes

- **WHEN** two roster rows are created at the same outlet concurrently, neither
  supplying a code
- **THEN** both succeed and the two codes differ

#### Scenario: A code already taken at that outlet is not issued twice

- **WHEN** issuing generates a code that a roster row at the same outlet
  already carries
- **THEN** another is generated instead, and the insert succeeds

### Requirement: An outlet's staff-code prefix is unique and fixed once used

Every outlet SHALL carry a short staff-code prefix, unique across all outlets,
because a prefix truncated from an outlet's name can collide — a future
Kalimpong would otherwise share Kalyani's. The database SHALL refuse a prefix
another outlet already holds.

The prefix SHALL be proposed automatically when an outlet is created, and SHALL
remain correctable while that outlet has no roster rows. Once any staff code
has been issued at an outlet, its prefix SHALL be fixed, because every code
already issued reads from it and changing it would leave those codes naming an
outlet prefix that no longer exists.

#### Scenario: A new outlet is proposed a prefix

- **WHEN** an admin creates an outlet
- **THEN** a prefix is proposed from the outlet's own code, shown on the form,
  and stored with the outlet

#### Scenario: A prefix another outlet holds is refused

- **WHEN** an outlet is created or edited with a staff-code prefix that another
  outlet already carries
- **THEN** the database refuses the write and the surface says the prefix is
  taken

#### Scenario: The prefix is correctable before anyone is on the roster

- **WHEN** an admin changes the staff-code prefix of an outlet that has no
  roster rows
- **THEN** the change is accepted

#### Scenario: The prefix is fixed once a staff code exists

- **WHEN** an admin attempts to change the staff-code prefix of an outlet that
  has at least one roster row
- **THEN** the database refuses the change, and the surface explains that codes
  have already been issued from it

### Requirement: Only the owner changes a staff code, and the database is the boundary

A staff code SHALL be changeable after it is issued, and only by a Super Admin.
A Franchise Admin SHALL be able to edit every other field on a roster row they
manage and SHALL NOT be able to change its staff code. The refusal SHALL be
made by the database, not only by the form, because `employees` updates are
written by the admin's own session under Row-Level Security and a policy that
permits the row permits every column on it.

The surface SHALL reflect this: the field is editable for a Super Admin and
inert for anyone else, so the refusal is not discovered by attempting it.

#### Scenario: A Franchise Admin cannot change a staff code

- **WHEN** a Franchise Admin attempts to change the staff code on a roster row
  in their own outlet, by any path including a hand-crafted request
- **THEN** the database refuses the write, and the row keeps its code

#### Scenario: A Franchise Admin still edits the rest of the row

- **WHEN** a Franchise Admin changes a roster row's name, role, phone, joining
  date or employment status
- **THEN** the write succeeds

#### Scenario: The owner changes a staff code

- **WHEN** a Super Admin sets a new staff code on a roster row
- **THEN** the write succeeds and the roster shows the new code

#### Scenario: A code already used at that outlet is refused

- **WHEN** a Super Admin sets a staff code that another roster row at the same
  outlet already carries
- **THEN** the write is refused and the surface says the code is already in use

## MODIFIED Requirements

### Requirement: A staff code is never blank

A roster row SHALL carry a non-empty staff code, enforced by the database and
not only by a form. A code consisting of whitespace SHALL be refused, because a
staff code identifies a person's records for years and a blank one identifies
nothing.

Absence and blankness are answered differently depending on the write. On
insert, a missing or blank code is a request for one to be issued, and the
database SHALL fill it. On update, a blank code is a mistake rather than a
request — the row already has a code — and the database SHALL refuse it rather
than silently substituting one, so that clearing the field never quietly
becomes renaming it.

#### Scenario: A blank staff code on insert is filled, not refused

- **WHEN** a roster row is inserted with no staff code, or one that is entirely
  whitespace
- **THEN** the write succeeds and the row carries an issued code

#### Scenario: Blanking an existing staff code is refused

- **WHEN** any caller updates a roster row's staff code to empty or entirely
  whitespace
- **THEN** the database refuses the write

### Requirement: Provisioning an Employee offers the roster and never assumes it

When an admin provisions an account in the Employee role, the form SHALL offer
an explicit choice: add the person to the staff roster, link them to someone
already on the roster, or leave them off it. It SHALL NOT create a roster row
as a silent side effect of provisioning, because having a login and being on
the payroll are different facts about a person.

Provisioning and linking are two writes and MAY partially fail. When the
account is created but the roster write is refused, the surface SHALL still
present the one-time code, SHALL state that the person has an account but is
not yet on the roster, and the resulting state SHALL be repairable from the
Staff surface.

#### Scenario: Provisioning with a new roster entry

- **WHEN** an admin provisions an Employee and chooses to add them to the roster
- **THEN** the account, the roster row and the link between them all exist, the
  roster row carries an issued staff code, and the one-time code is shown once

#### Scenario: Provisioning without a roster entry

- **WHEN** an admin provisions an Employee and chooses to leave them off the
  roster
- **THEN** the account exists with no roster row, and both surfaces show that
  the person cannot check in

#### Scenario: The roster write fails after the account is created

- **WHEN** provisioning succeeds and the roster write is refused
- **THEN** the code is still shown, the failure is explained as an unfinished
  link rather than a failed provisioning, and the account appears on the Staff
  surface as available to link

#### Scenario: The staff-list answer is incomplete

- **WHEN** an admin chooses to link someone to somebody already on the staff
  list without saying who
- **THEN** neither the account nor the roster row is created, and the form says
  which answer is missing
