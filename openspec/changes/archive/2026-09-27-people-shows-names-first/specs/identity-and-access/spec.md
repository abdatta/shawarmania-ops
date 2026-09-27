## MODIFIED Requirements

### Requirement: Admins manage accounts from a task-based surface scoped to their authority

The Super Admin SHALL have a People surface listing accounts across all outlets.
The Franchise Admin SHALL have one listing every person holding a live assignment
at an outlet they manage, and SHALL be offered account tasks, usernames and
account status only for the accounts they are permitted to manage; a listed
person they may not manage SHALL be shown without a username or tasks, stating
that the owner manages that account. A person's menu SHALL offer recognizable
tasks: Edit, Change username, Set up account or Reset password according to
lifecycle state, Change sign-in email where permitted, and Deactivate or
Reactivate.

Edit SHALL contain personal facts and authorized placement. It SHALL show one outlet and one access role for a single ordinary assignment, and SHALL progressively reveal assignment rows through a control labelled “Works at multiple outlets”. A person already holding zero, several, or mixed-role assignments SHALL open in the expanded form. Username SHALL remain a separate credential action.

A newly issued handover SHALL be presented once through one reusable purpose-aware component with a prominent QR, primary copy action, highlighted username, one-use and expiry facts, and only warnings relevant to that state. It SHALL NOT be retrievable afterwards.

#### Scenario: The common edit is simple

- **WHEN** an admin edits a person with one ordinary outlet assignment
- **THEN** the initial form shows their facts, one outlet, and one access role without separate grant/end actions or an expanded assignment list

#### Scenario: Multi-outlet editing is disclosed deliberately

- **WHEN** the admin selects Works at multiple outlets or edits a person who already has several assignments
- **THEN** one row per outlet is shown with its single role and permitted add/remove controls

#### Scenario: The Franchise Admin list and controls are authority-scoped

- **WHEN** a Franchise Admin opens People or hand-crafts an edit
- **THEN** they can switch Employee and Biller only at outlets they manage and cannot grant, alter, or remove Franchise Admin or Super Admin authority

#### Scenario: A person who also works elsewhere is listed and not managed

- **WHEN** a person holds a live Employee assignment at an outlet a Franchise Admin
  manages and another at an outlet they do not, and that Franchise Admin opens
  People
- **THEN** the person is listed with the assignment the Franchise Admin can see,
  no username and no tasks, and the row states that the owner manages the account

#### Scenario: The handover is concise and purpose-aware

- **WHEN** an admin issues account setup and separately issues password reset
- **THEN** the same visual component presents the same QR/copy/security facts with distinct setup or reset headings and no misleading “New code” label

## ADDED Requirements

### Requirement: People shows its people before their sign-in details

People SHALL present each listed person's name, job title and assignments as soon
as they are read, without waiting for usernames, account status or account
tasks, which come from the privileged account function. Until those arrive a row
SHALL show no username, no status and no task, and SHALL NOT show a status it has
not established. If they cannot be read, the people SHALL remain listed and the
surface SHALL say that sign-in details could not be loaded.

Which people are listed SHALL NOT change when the sign-in details arrive.

#### Scenario: Names before sign-in details

- **WHEN** the owner opens People and the account function has not yet answered
- **THEN** every person is listed by name with where they work, and no row shows a
  username, a status or a task

#### Scenario: The account function fails

- **WHEN** the account function cannot be reached
- **THEN** the people stay listed and the surface says their sign-in details could
  not be loaded, and no task is offered
