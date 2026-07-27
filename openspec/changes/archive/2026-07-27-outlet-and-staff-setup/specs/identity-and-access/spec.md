## ADDED Requirements

### Requirement: An app account and a roster row are linked from either screen

An app account SHALL be linkable to a roster row at the same outlet, and the
link SHALL be creatable from both directions: from the Staff surface, by
attaching an existing unlinked account to a person on the roster; and from the
account surface, while provisioning an Employee.

The link SHALL be stored as `employees.profile_id`, written by the admin's own
session under Row-Level Security — never by a privileged function holding the
service-role key. The database SHALL refuse a link whose account belongs to a
different outlet than the roster row, and SHALL refuse linking one account to a
second roster row.

#### Scenario: Linking from the Staff surface

- **WHEN** an admin attaches an unlinked account at their outlet to a roster row
- **THEN** the link is stored, and that person can thereafter find their own
  roster row and check in

#### Scenario: A cross-outlet link is refused by the database

- **WHEN** any caller attempts to set a roster row's linked account to an
  account belonging to a different outlet
- **THEN** the write is refused by the database, not merely by the form

#### Scenario: One account cannot hold two roster rows

- **WHEN** an admin attempts to link an account that is already linked to
  another roster row
- **THEN** the write is refused and the surface explains that the account is
  already on the roster as someone else

#### Scenario: A Franchise Admin cannot link outside their outlet

- **WHEN** a Franchise Admin attempts to write a link on a roster row belonging
  to another outlet
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
  with a staff code
- **THEN** the account, the roster row and the link between them all exist, and
  the one-time code is shown once

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

- **WHEN** an admin chooses to add someone to the roster but supplies no staff
  code, or chooses to link them to somebody already on it without saying who
- **THEN** neither the account nor the roster row is created, and the form says
  which answer is missing

### Requirement: An admin can see and correct the address an account signs in with

The email address an account signs in with SHALL be visible to the admins who
may manage that account, and correctable by them. A newly issued code SHALL be
presented alongside the address it belongs to, so that a typo is read at the
moment the code is about to be passed on.

Correcting an address SHALL NOT invalidate an outstanding one-time code: the
code is bound to the account, not to the address, and reissuing would cancel a
message the admin has already sent.

This exists because a mistyped address is otherwise unrecoverable. Redemption
and sign-in both refuse an unknown address with the same uniform message they
give a wrong password — deliberately, to prevent enumeration — so a typo
presents as "the code does not work", with nothing on any screen to contradict
it.

#### Scenario: The address is read back before the code is handed over

- **WHEN** an admin provisions an account or re-issues a code
- **THEN** the address the account will sign in with is shown beside the code

#### Scenario: A mistyped address is corrected in the app

- **WHEN** an admin corrects the address on an account they may manage
- **THEN** the account signs in with the new address, and the one-time code
  already issued for it still works

#### Scenario: An address already in use is refused

- **WHEN** an admin sets an address that another account already holds
- **THEN** the change is refused and the surface says the address is taken

### Requirement: Staff email addresses are not readable from the counter tablet

Email addresses SHALL NOT be stored on `public.profiles`, which a Biller may
read for their own outlet — a Biller is a shared counter tablet, and colleagues'
contact details must not become ambient on a device anyone can pick up.

The address SHALL be served only by the privileged function, per caller, for
the accounts that caller may manage. A caller with no management authority
SHALL be refused outright rather than handed an empty result.

#### Scenario: A Biller asks for addresses

- **WHEN** a Biller's session calls the privileged account function for email
  addresses
- **THEN** the request is refused, and no address is returned by any other path

#### Scenario: A Franchise Admin sees only their own outlet's addresses

- **WHEN** a Franchise Admin loads the account surface
- **THEN** addresses are present for their own outlet's Billers and Employees,
  and for no account outside their authority

### Requirement: A staff code is never blank

A roster row SHALL carry a non-empty staff code, enforced by the database and
not only by a form. A code consisting of whitespace SHALL be refused, because a
staff code identifies a person's records for years and a blank one identifies
nothing.

#### Scenario: A whitespace staff code is refused

- **WHEN** any caller inserts or updates a roster row whose staff code is empty
  or entirely whitespace
- **THEN** the database refuses the write

### Requirement: Every people surface answers whether a person can check in

The Staff surface SHALL show, for each person, whether an app account is linked
to them and whether that account is active. The account surface SHALL show, for
each account that could be on the roster, whether it is. Where a person cannot
check in, the reason SHALL be readable on the screen — no app account, an
inactive account, or not on the roster — so that the question is answerable
during a phone call without anyone opening the database.

#### Scenario: A roster row with no account

- **WHEN** the Staff surface lists a person with no linked account
- **THEN** the row states that they have no app account and cannot check in

#### Scenario: An account with no roster row

- **WHEN** the account surface lists an Employee account that is on no roster
- **THEN** the row states that they are not on the roster and cannot check in

#### Scenario: A linked pair reads as working

- **WHEN** a roster row has an active linked account
- **THEN** the Staff surface names the linked account, and nothing on either
  surface suggests a problem

### Requirement: Unlinking is reversible and never erases worked days

An admin SHALL be able to remove the link between an account and a roster row.
Removing it SHALL stop that account from reading or writing that roster row's
attendance, and SHALL leave every attendance record already recorded against
the roster row in place, because the days were worked.

The confirmation SHALL state both consequences before the link is removed.

#### Scenario: Unlinking stops access and keeps history

- **WHEN** an admin removes the link between an account and a roster row that
  has recorded attendance
- **THEN** the roster row keeps every attendance record, and the account can no
  longer read or write any of them

#### Scenario: The consequence is stated before it happens

- **WHEN** an admin is about to remove a link
- **THEN** the confirmation says that the person will no longer be able to check
  in, and that their recorded days remain on the roster
