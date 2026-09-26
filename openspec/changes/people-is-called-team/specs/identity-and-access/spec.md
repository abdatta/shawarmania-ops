## RENAMED Requirements

- FROM: `### Requirement: Every People surface states account readiness truthfully`
- TO: `### Requirement: Every Team surface states account readiness truthfully`

- FROM: `### Requirement: People shows its people before their sign-in details`
- TO: `### Requirement: Team shows its people before their sign-in details`

## MODIFIED Requirements

### Requirement: Account email is private, optional by default, and required for Super Admin

Every person with a live Super Admin assignment SHALL have exactly one
normalized account email. A person with no live Super Admin assignment MAY have
zero or one account email. The Super Admin requirement SHALL be enforced after
the complete database transaction, including against hand-crafted assignment
writes.

Account email SHALL be private account data, SHALL be a permanent alternate
sign-in identifier for that same account, and SHALL NOT be stored on
`public.profiles`.
Only a Super Admin management path may read or change another Super Admin's
account email. A Super Admin MAY see their own address read-only until a
later self-service settings surface exists.

#### Scenario: Creating a Super Admin requires account email

- **WHEN** an authorized Super Admin creates another Super Admin without an
  account email
- **THEN** the complete request is refused and no partial account is created

#### Scenario: Ordinary creation does not require account email

- **WHEN** an authorized admin creates an Employee, Biller, or Franchise Admin
  through the Team form
- **THEN** no email is requested and no account-email row is required

#### Scenario: A future ordinary-role email remains compatible

- **WHEN** an authorized future account-email path associates an email with a
  person who has no Super Admin assignment
- **THEN** the private row is valid and that email becomes an alternate sign-in
  identifier without granting recovery or role authority

#### Scenario: Granting Super Admin and its account email is atomic

- **WHEN** a Super Admin grants a person a live Super Admin assignment
- **THEN** a valid account email is required and the assignment plus private
  email either both commit or neither commits

#### Scenario: Ending the final Super Admin assignment keeps the associated email

- **WHEN** a person's final live Super Admin assignment is ended while another
  live Super Admin remains
- **THEN** the assignment ends but the private account email remains an
  alternate sign-in identifier until separately removed

### Requirement: Provisioning authority is re-derived from the caller's token

A privileged account function SHALL determine the caller's assignments from the
caller's own verified session, never from values supplied in the request. A
Super Admin MAY provision, re-issue, and deactivate any account other than
their own. A Franchise Admin MAY provision Biller and Employee accounts only
when every requested outlet is one at which the caller holds a live Franchise
Admin assignment, and MAY re-issue or deactivate only where every outlet the
target person is assigned to is one they manage. Every other combination SHALL
be refused.

The complete requested outlet set SHALL be validated before any auth user,
profile, assignment, or invite is written. Refusal SHALL apply to a
hand-crafted privileged request regardless of what the Team form offers.

#### Scenario: A Franchise Admin cannot provision outside their outlets

- **WHEN** a Franchise Admin hand-crafts a provision request whose outlet set
  includes an outlet where they hold no live Franchise Admin assignment
- **THEN** the complete request is refused and no account, profile, assignment,
  or invite is created

#### Scenario: A multi-outlet Franchise Admin provisions within their authority

- **WHEN** a Franchise Admin requests a Biller or Employee account at several
  outlets and holds a live Franchise Admin assignment at every one
- **THEN** the request succeeds with one account and one assignment at each
  requested outlet

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

### Requirement: A one-time code is single-use, time-limited, attempt-limited, and purpose-bearing

Provisioning SHALL issue a one-time activation code that is shown to the issuing admin exactly once and stored only as a hash. An authorized admin helping an established account recover SHALL issue a password-reset code. Every invite SHALL store which of those two purposes it serves.

The code SHALL expire after a bounded lifetime, SHALL be redeemable at most once, and repeated failed redemptions SHALL be bounded at the redemption endpoint rather than per invite. Issuing a new code of the same purpose for an account SHALL supersede the previous live code. An invite SHALL count as live only while it is unconsumed, unsuperseded, and unexpired; an expired row SHALL NOT create an outstanding account state.

#### Scenario: Provisioning issues activation

- **WHEN** an account is provisioned
- **THEN** the one-time response identifies an activation handover, and the stored row contains an activation purpose and only the code hash

#### Scenario: Established-account recovery issues reset

- **WHEN** an authorized admin helps a person who has successfully signed in before
- **THEN** a password-reset handover is issued and no state says that first activation is pending

#### Scenario: An expired row is not outstanding

- **WHEN** an unused invite passes its expiry
- **THEN** redemption is refused and Team no longer treats the account as having a live handover

#### Scenario: Repeated wrong codes are bounded

- **WHEN** wrong codes are presented repeatedly
- **THEN** the endpoint rate limit refuses further attempts without disabling a legitimate code through another person's guesses

#### Scenario: Replacement supersedes the same handover

- **WHEN** an admin replaces a live activation or password-reset handover
- **THEN** the former code is no longer redeemable and only the newly displayed code works

### Requirement: Admins manage accounts from a task-based surface scoped to their authority

The Super Admin SHALL have a Team surface listing accounts across all outlets.
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

- **WHEN** a Franchise Admin opens Team or hand-crafts an edit
- **THEN** they can switch Employee and Biller only at outlets they manage and cannot grant, alter, or remove Franchise Admin or Super Admin authority

#### Scenario: A person who also works elsewhere is listed and not managed

- **WHEN** a person holds a live Employee assignment at an outlet a Franchise Admin
  manages and another at an outlet they do not, and that Franchise Admin opens
  Team
- **THEN** the person is listed with the assignment the Franchise Admin can see,
  no username and no tasks, and the row states that the owner manages the account

#### Scenario: The handover is concise and purpose-aware

- **WHEN** an admin issues account setup and separately issues password reset
- **THEN** the same visual component presents the same QR/copy/security facts with distinct setup or reset headings and no misleading “New code” label

### Requirement: Login identifiers and account emails stay off the counter tablet

Usernames, provider aliases, and account email SHALL NOT be stored on
`public.profiles`, which a Biller may read for their own outlet. The identifier
response SHALL be served only by the privileged account function, per caller,
for accounts that caller may support. Account email SHALL be narrower still:
only an authorized Super Admin path may receive it.

A caller with no management authority SHALL be refused outright rather than
handed an empty identifier response.

#### Scenario: A Biller asks for identifiers

- **WHEN** a Biller session calls the privileged account function for usernames
  or account emails
- **THEN** the request is refused and neither value is returned by any other
  client-readable path

#### Scenario: A Franchise Admin sees only supported usernames

- **WHEN** a Franchise Admin loads Team
- **THEN** usernames are present only for people wholly within their management
  authority and no account email is present

#### Scenario: A Super Admin sees another Super Admin's account email narrowly

- **WHEN** a Super Admin manages another live Super Admin
- **THEN** that target's account email is available for correction without
  exposing it to any outlet-scoped role

### Requirement: Every Team surface states account readiness truthfully

Team SHALL derive status from active state, successful sign-in history, live assignments, and a live unexpired handover purpose. A pending password reset SHALL NOT make an established account read as awaiting activation, and an expired invitation SHALL NOT create a pending status.

#### Scenario: A deactivated person reads as such

- **WHEN** Team lists a person whose account is deactivated
- **THEN** the row states Deactivated regardless of historical invitation rows

#### Scenario: A new account is awaiting setup

- **WHEN** a person has never successfully signed in and has a live activation link
- **THEN** the row states that setup is pending and offers Replace setup link

#### Scenario: An established account has reset pending

- **WHEN** a person has successfully signed in before and has a live password-reset link
- **THEN** the row remains active and states Password reset issued

#### Scenario: Expiry removes pending status

- **WHEN** the only unused link is expired
- **THEN** Team does not describe that link as pending and offers the appropriate fresh setup or reset action

#### Scenario: A person with no assignment reads as unplaced

- **WHEN** Team lists an active person with no live assignment
- **THEN** the row states that they are not assigned to an outlet

### Requirement: A person's name is never blank

A person's account SHALL carry a non-empty full name, enforced by the
database and not only by a form. A name consisting entirely of whitespace
SHALL be refused.

A name is the only field on the record that a human reads to know who the
record is about — and since staff codes retired it is the only one at all.
Two people with the same name are told apart by their job title and where
they work; neither identifies a person with no name.

The surface that writes the record SHALL refuse before writing and SHALL name
the field that is missing, on the Team surface's create and edit paths
alike.

#### Scenario: A person cannot be created without a name

- **WHEN** an admin submits the Team form with the full name empty or
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

### Requirement: Team shows its people before their sign-in details

Team SHALL present each listed person's name, job title and assignments as soon
as they are read, without waiting for usernames, account status or account
tasks, which come from the privileged account function. Until those arrive a row
SHALL show no username, no status and no task, and SHALL NOT show a status it has
not established. If they cannot be read, the people SHALL remain listed and the
surface SHALL say that sign-in details could not be loaded.

Which people are listed SHALL NOT change when the sign-in details arrive.

#### Scenario: Names before sign-in details

- **WHEN** the owner opens Team and the account function has not yet answered
- **THEN** every person is listed by name with where they work, and no row shows a
  username, a status or a task

#### Scenario: The account function fails

- **WHEN** the account function cannot be reached
- **THEN** the people stay listed and the surface says their sign-in details could
  not be loaded, and no task is offered
