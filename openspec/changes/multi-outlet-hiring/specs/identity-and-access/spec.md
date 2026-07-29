## MODIFIED Requirements

### Requirement: Accounts are provisioned by an admin, never self-registered

Account creation SHALL be an administrative action performed through a
privileged server-side function that holds the service-role credential. Self-
service registration SHALL be disabled. The created account SHALL have its
email address pre-confirmed, so no confirmation message is ever sent. The
service-role credential MUST NOT be reachable from the browser.

For every outlet-scoped role, provisioning SHALL accept one or more outlets
and SHALL create one live assignment for the selected role at each outlet
before issuing one activation code. A Super Admin account SHALL accept no
outlet because that role is business-wide and singular.

#### Scenario: An admin creates an account at several outlets

- **WHEN** an admin submits a name, email, role, and one or more outlets for a
  new person
- **THEN** one account is created with the email pre-confirmed, one profile
  exists, a live assignment for that role exists at every selected outlet, and
  one one-time code is returned to the admin after all assignments exist

#### Scenario: A Super Admin request carrying outlets is contradictory

- **WHEN** an admin requests a Super Admin account and also names one or more
  outlets
- **THEN** the request is refused and no account, profile, assignment, or code
  is created

#### Scenario: Self-registration is refused

- **WHEN** anyone attempts to register an account directly against the
  authentication service
- **THEN** the attempt is refused

### Requirement: Provisioning authority is re-derived from the caller's token

A privileged account function SHALL determine the caller's assignments from
the caller's own verified session, never from values supplied in the request.
A Super Admin MAY provision, re-issue, and deactivate any account other than
their own. A Franchise Admin MAY provision Biller and Employee accounts only
when every requested outlet is one at which the caller holds a live Franchise
Admin assignment, and MAY re-issue or deactivate only where every outlet the
target person is assigned to is one they manage. Every other combination SHALL
be refused.

The complete requested outlet set SHALL be validated before any auth user,
profile, assignment, or invite is written. Refusal SHALL apply to a
hand-crafted privileged request regardless of what the People form offers.

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

### Requirement: An assignment change takes effect without ending the session

An assignment granted or ended while a person's app is open SHALL take effect
at the database immediately, and the open client SHALL reflect it within a
bounded interval without the person signing in again. Nothing about authority
is carried in the token, so no session token is reissued.

A client SHALL NOT render a shell or a surface for a role it holds no live
assignment for. A person who loses every live assignment SHALL be returned to a
state that offers no outlet surfaces and states why.

When a permitted assignment grant or end affects a person with an unconsumed,
unsuperseded activation code, the assignment change and replacement invite
SHALL complete in one database transaction: the existing code SHALL be
superseded, a new code SHALL be issued after the changed assignment set exists,
and the admin SHALL be shown the new code in the same action. The reassignment
trigger SHALL remain enabled. An assignment change for a person without an
outstanding code SHALL NOT create one.

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

#### Scenario: A grant replaces and reveals an outstanding code

- **WHEN** an admin grants an assignment to a person who has an outstanding
  activation code
- **THEN** the old code is no longer redeemable, the changed assignment set
  exists before a replacement code is issued, and the replacement is shown to
  the admin in the completed grant action

#### Scenario: Ending an assignment replaces and reveals an outstanding code

- **WHEN** an admin ends an assignment for a person who has an outstanding
  activation code
- **THEN** the old code is no longer redeemable, the changed assignment set
  exists before a replacement code is issued, and the replacement is shown to
  the admin in the completed end action

#### Scenario: An activated person gets no unsolicited reset code

- **WHEN** an admin grants or ends an assignment for a person with no
  outstanding activation code
- **THEN** the assignment changes and no new code is issued

### Requirement: A person is created once, as an account

Creating a staff member SHALL be one act on one surface: the admin supplies the
person's name, address, phone, one role, one or more outlets, and optionally a
job title, and the result is a single record that is simultaneously their
login and their staff-list membership, together with an assignment at every
selected outlet. No separate roster write, link step, or second surface SHALL
exist anywhere in the UI.

The person's job title (`role_title`) lives on the account record; where they
work and from when lives on each assignment. One optional joined date supplied
at creation SHALL apply to every assignment created in that action. Editing the
job title SHALL be done by the admin's own session under Row-Level Security — a
Super Admin for any account, a Franchise Admin for people assigned to an outlet
they manage — while identity and access fields (active state, email) and
assignments themselves remain governed by their own boundaries.

The create form SHALL keep the role as one selection. It SHALL offer a
phone-usable multi-select only when the caller may provision at more than one
outlet. A Franchise Admin who manages exactly one outlet SHALL continue to see
that outlet preselected in the unchanged singular disabled control.

#### Scenario: One step creates a person working at several outlets

- **WHEN** an admin creates a person in the Employee role at several outlets
  with a name, address, and job title
- **THEN** one create action yields one account, one live Employee assignment
  at every selected outlet, and one activation code; the person appears on
  every selected outlet's staff list immediately, and no linking step exists
  or is needed before they can check in once activated

#### Scenario: A one-outlet manager's form stays simple

- **WHEN** a Franchise Admin who manages exactly one outlet opens the create
  form
- **THEN** that outlet remains preselected in the singular disabled outlet
  control and no multi-select is shown

#### Scenario: A Biller may be created at several outlets

- **WHEN** an authorized admin selects the Biller role and several outlets
- **THEN** one Biller account receives one assignment at every selected outlet;
  physical tablet-to-outlet scope remains the responsibility of device
  enrollment

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
