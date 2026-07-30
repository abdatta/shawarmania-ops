## ADDED Requirements

### Requirement: Usernames are canonical and unique across the business

Every human account SHALL have one canonical username shared by all of that
person's roles and outlet assignments. Input SHALL be trimmed and lowercased
before validation. The canonical username SHALL be 3–30 ASCII characters drawn
only from `a`–`z`, `0`–`9`, period, and underscore. It SHALL NOT begin or end
with a period or contain consecutive periods. An `@` prefix, internal
whitespace, hyphen, or any other character SHALL be refused at the privileged
identity boundary.

Username uniqueness SHALL be case-insensitive and business-wide. The system
MAY suggest and lowercase a username before submission, but it SHALL NOT
silently choose a different available value after the admin submits.

#### Scenario: An Instagram-style handle without the at sign is accepted

- **WHEN** an authorized admin submits `rahul.k_2` for a new account
- **THEN** the username passes shape validation and is checked against the one
  business-wide namespace

#### Scenario: An at-prefixed spelling is refused

- **WHEN** an admin submits `@rahul` as the username
- **THEN** the request is refused and no account, profile, assignment,
  account-email row, or invite is created

#### Scenario: Case cannot create a second account

- **WHEN** one account already uses `rahul.k` and an admin submits `Rahul.K`
- **THEN** the request is refused as unavailable rather than creating a
  case-variant account

#### Scenario: A collision is returned for the admin to resolve

- **WHEN** the requested canonical username is already held
- **THEN** the form states that the username is unavailable and the system does
  not substitute a suffix or another username

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

- **WHEN** an authorized Super Admin creates another Super Admin without a
  account email
- **THEN** the complete request is refused and no partial account is created

#### Scenario: Ordinary creation does not require account email

- **WHEN** an authorized admin creates an Employee, Biller, or Franchise Admin
  through the People form
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

### Requirement: Auth aliases are provider plumbing and never product data

The authentication provider SHALL encode a canonical username in a
non-deliverable reserved-domain alias so that its native password and session
machinery remains in use. That alias SHALL never be displayed, exported, used
as a deliverable address, or accepted from a product form. No authentication message
SHALL be delivered to it.

An authenticated person SHALL NOT be able to change that alias through a
hand-crafted provider request. Only the privileged username-management path may
change it, while preserving the existing Auth user ID, password, and sessions.

#### Scenario: A session contains the provider alias

- **WHEN** the authentication provider returns its internal identifier in a
  session payload
- **THEN** application UI exposes only the parsed canonical username and never
  renders the reserved-domain alias

#### Scenario: A user tries to change the alias directly

- **WHEN** an authenticated user hand-crafts an Auth email-change request
- **THEN** the change cannot complete and their canonical username is unchanged

#### Scenario: Ordinary authentication sends no mail

- **WHEN** a person signs in, is provisioned, activates, receives an
  admin-issued reset, or has their username corrected
- **THEN** no email or SMS is sent and no message is addressed to the provider
  alias

### Requirement: Username migration preserves every account in place

Moving existing accounts from email sign-in to usernames SHALL update each
existing Auth user rather than create a replacement. The migration SHALL
preserve user ID, password hash, refresh sessions, profile, assignment and
invite rows, attendance and operational history, active state, and role
authority.

The owner SHALL review a complete proposed username mapping before it is
applied. Collisions and malformed suggestions SHALL stop the migration rather
than receive an automatic suffix. A real email SHALL be retained as private
account email only when explicitly approved, and every live Super Admin SHALL
have one. Every placeholder address SHALL be absent from live identity or
account-email data when the change completes.

#### Scenario: An activated Employee crosses the migration

- **WHEN** an existing Employee with a password, open refresh session,
  assignments, and attendance history receives an approved username
- **THEN** the same account and history remain, the open session remains
  authorized by its assignments, and the new username works with the existing
  password

#### Scenario: A pending invite crosses the migration

- **WHEN** an existing account has an unconsumed one-time code during migration
- **THEN** the same code remains live and its preview shows the owner-approved
  username

#### Scenario: A placeholder account is mapped deliberately

- **WHEN** an existing account uses a migration placeholder address
- **THEN** the migration stops until the owner approves a valid unique username
  and no placeholder survives the completed migration

#### Scenario: The completed migration retains only approved account email

- **WHEN** post-migration invariants inspect every human account
- **THEN** every Auth primary identity is a canonical provider alias, every live
  Super Admin has private account email, every other retained account email was
  explicitly approved, and no placeholder email remains

#### Scenario: Production mappings never enter source control

- **WHEN** the owner-approved production mapping is prepared and applied
- **THEN** its usernames and emails exist only in the gitignored operator file
  and production identity state, not in a tracked source, test, fixture,
  document, or commit message

### Requirement: Permanent frontend deployment waits for identity readiness

The static production frontend SHALL NOT build or upload unless an
already-deployed backend probe confirms the username rollout is ready. The
probe SHALL fail closed when its Edge Function or private database invariant is
missing or unavailable, the request times out, the response is malformed, or
either public Supabase build variable is absent.

Readiness SHALL require at least one active live Super Admin with private
account email; a canonical reserved Auth alias, matching email-provider
identity, and matching profile for every non-deleted Auth user; and no profile
orphaned from Auth. The database invariant SHALL be service-role-only. The
public response SHALL expose only a boolean and no failed condition, count,
username, provider alias, email, or profile ID.

#### Scenario: A frontend push races the account migration

- **WHEN** any live Auth account still uses a legacy identifier or lacks its
  matching profile or email-provider identity
- **THEN** the readiness probe returns false and GitHub Pages retains the
  previously published artifact

#### Scenario: Production identity is ready

- **WHEN** every private database invariant is satisfied
- **THEN** the probe returns exactly a positive readiness boolean and the Pages
  workflow may continue to build and upload

### Requirement: Credential forms expose password-manager semantics without promising browser UI

The ordinary sign-in form SHALL mark its identifier as `username` and its
password as `current-password`. Activation and admin-issued reset forms SHALL
mark their identifier as `username` and both new-password entries as
`new-password`. Every control SHALL have a stable name and belong to a
submittable form.

A successful credential submission SHALL establish or continue a session and
perform client-side navigation that removes the submitted form. The
application SHALL NOT promise that Chrome or another browser will display a
save prompt, because that decision remains under browser and user policy.

#### Scenario: Sign-in is recognizable to a password manager

- **WHEN** the ordinary sign-in form is inspected
- **THEN** one username field and one current-password field belong to the same
  submittable form

#### Scenario: Activation is recognizable as setting a credential

- **WHEN** the activation form is inspected
- **THEN** its username and two new-password fields belong to the same
  submittable form

#### Scenario: Successful activation leaves the credential page

- **WHEN** activation sets the password and signs the person in
- **THEN** route navigation removes the credential form instead of merely
  hiding it in place

## MODIFIED Requirements

### Requirement: Every account signs in with username, and associated email is an alternate

The application SHALL authenticate every human role with a canonical username
and password. The person SHALL type the username without an `@`. If the account
has an associated private email, the same password SHALL also authenticate that
same account when the person enters the email. Phone numbers SHALL NOT be
accepted as sign-in identifiers.

Username password authentication SHALL call the authentication provider
directly. Email authentication SHALL use a narrowly scoped server bridge that
privately resolves the current Auth alias and delegates password verification
and session minting to the provider with its public client credential. The
bridge SHALL NOT verify or retain passwords, mint a custom session, expose the
email-to-username mapping, or log raw email, password, alias, access token, or
refresh token.

Unknown username, unknown email, unassociated email, inactive account, malformed
identifier, rate-limited email, and wrong password SHALL remain
indistinguishable in the product.

#### Scenario: A provisioned account signs in

- **WHEN** a person with an active account enters their canonical username and
  correct password on the sign-in screen
- **THEN** a session is established and they are taken to a shell for a role
  they currently hold

#### Scenario: An associated email signs in to the same account

- **WHEN** a person whose account has an associated email enters that email and
  the correct password
- **THEN** the provider establishes a normal session for the same Auth user ID
  reached by their username

#### Scenario: An account without email still signs in

- **WHEN** an Employee has no associated email
- **THEN** their canonical username and password work and no email is required

#### Scenario: Email resolution remains private

- **WHEN** email sign-in is attempted with an unknown address, an inactive
  account address, and a real address plus wrong password
- **THEN** every attempt returns the same credential refusal and no username,
  alias, user ID, or resolution result is disclosed

#### Scenario: An at-prefixed username is refused

- **WHEN** a person enters `@rahul` on the sign-in screen
- **THEN** no session is established and the screen explains that usernames do
  not include the at sign

#### Scenario: A wrong password is refused uniformly

- **WHEN** sign-in is attempted with an unknown username, and separately with a
  wrong password for a real username
- **THEN** both attempts produce the same username-or-password refusal

#### Scenario: A former unassociated email does not sign in

- **WHEN** a former address that was not retained in `account_emails` is
  submitted after migration
- **THEN** no session is established and the standard credential refusal is
  returned

### Requirement: Accounts are provisioned by an admin, never self-registered

Account creation SHALL be an administrative action performed through a
privileged server-side function that holds the service-role credential.
Self-service registration SHALL be disabled and the service-role credential
MUST NOT be reachable from the browser.

For every outlet-scoped role, provisioning SHALL accept one or more outlets
and SHALL create one live assignment for the selected role at each outlet
before issuing one activation code. A Super Admin account SHALL accept no
outlet because that role is business-wide.

The admin SHALL supply name, canonical username, and role. Outlet selection
SHALL be required for every outlet-scoped role, and account email SHALL be
required only for Super Admin. Phone, job title, and joined date SHALL remain
optional.

#### Scenario: An admin creates an ordinary account at several outlets

- **WHEN** an authorized admin submits a name, username, Employee role, and
  several permitted outlets without an email
- **THEN** one Auth account and profile are created, one live Employee
  assignment exists at every selected outlet, and one activation link is
  returned after all assignments exist

#### Scenario: An admin creates a Super Admin

- **WHEN** an authorized Super Admin submits a name, unique username, Super
  Admin role, no outlets, and a unique account email
- **THEN** one account, live Super Admin assignment, private account email,
  and activation link are created as one account-creation act

#### Scenario: A contradictory Super Admin request is refused

- **WHEN** a Super Admin provisioning request carries any outlet
- **THEN** no account, profile, assignment, account email, or invite is
  created

#### Scenario: Self-registration is refused

- **WHEN** anyone attempts to register an account directly against the
  authentication service
- **THEN** the attempt is refused

### Requirement: Redeeming a code sets a password and reveals nothing beyond its username

Redemption SHALL accept a code, the canonical username displayed by that code,
and a new password. It SHALL derive the account from the code, require no
existing session, enforce the minimum password length, and consume the code
only if the supplied username matches the account's current username.

Unknown, expired, already-redeemed, superseded, and inactive-account codes
SHALL produce an identical response. A canonical username mismatch SHALL
produce a specific correction response and SHALL NOT consume the code.
Ordinary redemption SHALL NOT return a session; the client signs in afterwards
through the everyday username/password path.

#### Scenario: First-run activation

- **WHEN** a newly provisioned person types the displayed username and matching
  valid new passwords
- **THEN** the password is set, the code is consumed, and the client signs in
  through the ordinary username path

#### Scenario: Dead-code failures are indistinguishable

- **WHEN** redemption is attempted with an unknown code, and separately with an
  expired one
- **THEN** both attempts produce the same response

#### Scenario: A username typo preserves the link

- **WHEN** a live code is submitted with a canonical username other than the
  one it currently identifies
- **THEN** the response names the username mismatch and the same code remains
  redeemable

#### Scenario: A too-short password is refused before consumption

- **WHEN** redemption is attempted with a password below the minimum length
- **THEN** the password refusal is specific and the code remains redeemable

### Requirement: An admin-issued code is every role's password reset path

For Franchise Admins, Billers, Employees, and Super Admins, password reset SHALL
be admin-initiated: an authorized admin issues a new one-time link and the
person redeems it with the displayed username and a new password typed twice.
One Super Admin MAY issue the link for another Super Admin. This change SHALL
NOT offer self-service forgotten-password recovery or send authentication mail.

#### Scenario: A staff member who forgot their password gets admin help

- **WHEN** an authorized admin reissues a link for an existing Employee and the
  person redeems it with their username and matching new passwords
- **THEN** the new password works, the previous password does not, and no mail
  or SMS is sent

#### Scenario: Sign-in offers no email-recovery control

- **WHEN** any role opens sign-in help after forgetting a password
- **THEN** they are told to ask an authorized admin and no recovery-address
  field is offered

### Requirement: Admins manage accounts from a surface scoped to their authority

The Super Admin SHALL have a People surface listing accounts across all
outlets, and the Franchise Admin SHALL have one listing accounts in outlets
within their authority only. Both SHALL support creating an account, reissuing
a code, changing another person's username, and deactivating or reactivating an
account within the authority limits of the caller's role.

A newly issued code SHALL be presented once as the activation link, QR image,
and copy action for the admin to pass on, and SHALL NOT be retrievable
afterwards. Username SHALL be visible wherever the admin must identify or
support an account. Account email SHALL appear only under the private owner
rules.

#### Scenario: The Franchise Admin list is authority-scoped

- **WHEN** a Franchise Admin opens People
- **THEN** only people wholly within their management authority are actionable,
  and no control offers a role, outlet, username change, or account email
  outside that authority

#### Scenario: The handover is shown once

- **WHEN** an admin provisions an account or reissues a code
- **THEN** the activation link is offered for copying and scanning, and
  revisiting the surface does not reveal it again

#### Scenario: Username is available during a support call

- **WHEN** an authorized admin opens a person's People detail
- **THEN** the current canonical username is visible without exposing a
  provider alias or private account email outside the owner rule

### Requirement: A person is created once, as an account

Creating a staff member SHALL be one act on one surface: the admin supplies the
person's name, username, one role, one or more role-appropriate outlets, and
optional staff facts, and the result is a single record that is simultaneously
their login and staff-list membership, together with an assignment at every
selected outlet. No separate roster write, linking step, or second surface
SHALL exist.

The person's job title (`role_title`) lives on the account record; where they
work and from when lives on each assignment. One optional joined date supplied
at creation SHALL apply to every assignment created in that action. Editing
staff facts SHALL remain the admin's own session under RLS, while username,
active state, account email, and assignments remain governed by their
identity and authority boundaries.

The create form SHALL keep role as one selection. It SHALL offer a phone-usable
outlet multi-select only when the caller may provision at more than one outlet.
A Franchise Admin who manages exactly one outlet SHALL continue to see that
outlet preselected in the singular disabled control.

#### Scenario: One step creates a person working at several outlets

- **WHEN** an admin creates an Employee with a name, username, optional job
  title, and several permitted outlets
- **THEN** one create action yields one account, one live Employee assignment
  at every selected outlet, and one activation link without requiring email or
  a later roster-linking step

#### Scenario: A one-outlet manager's form stays simple

- **WHEN** a Franchise Admin who manages exactly one outlet opens the create
  form
- **THEN** that outlet remains preselected in the singular disabled outlet
  control and no multi-select is shown

#### Scenario: A Biller may be created at several outlets

- **WHEN** an authorized admin selects Biller and several outlets
- **THEN** one Biller account receives one assignment at every selected outlet;
  future physical tablet scope remains device enrollment's responsibility

#### Scenario: Access fields stay out of direct client writes

- **WHEN** any client session attempts to write username, active state, or
  account email directly
- **THEN** the database/provider boundary refuses it and only the authorized
  privileged path can complete the change

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
and the admin SHALL be shown the new link in the same action. An assignment
change for a person without an outstanding code SHALL NOT create one.

Granting a Super Admin assignment SHALL require and atomically write an account
email. Ending a person's final live Super Admin assignment SHALL retain that
private email as an alternate sign-in identifier, and the existing
last-Super-Admin guard SHALL remain.

#### Scenario: A new assignment appears without signing out

- **WHEN** a person is granted an assignment at a second outlet while their app
  is open
- **THEN** the second outlet becomes available within the revalidation interval
  without sign-out or password re-entry

#### Scenario: An ended assignment stops rendering its shell

- **WHEN** the assignment behind the current shell is ended
- **THEN** the client stops rendering that shell within the revalidation
  interval and the database refuses its writes immediately

#### Scenario: Losing every assignment is stated

- **WHEN** a person's last live assignment is ended while their app is open
- **THEN** the app states that they are not currently assigned to any outlet
  rather than showing an empty shell

#### Scenario: A grant replaces an outstanding link

- **WHEN** an admin grants an assignment to a person with an outstanding code
- **THEN** the old code is superseded, the changed assignment set exists first,
  and one replacement activation link is shown

#### Scenario: Ending an assignment replaces an outstanding link

- **WHEN** an admin ends an assignment for a person with an outstanding code
- **THEN** the old code is superseded, the changed assignment set exists first,
  and one replacement activation link is shown

#### Scenario: An activated person gets no unsolicited reset

- **WHEN** an admin changes an assignment for a person with no outstanding code
- **THEN** the assignment changes and no invite or email is issued

#### Scenario: The Super Admin account-email requirement cannot be bypassed

- **WHEN** a Super Admin assignment is inserted through a hand-crafted database
  request for a person without an account-email row
- **THEN** the transaction is refused

### Requirement: An admin can see and correct the username an account signs in with

The current canonical username SHALL be visible to admins who may manage the
account and correctable by them. A newly issued activation link SHALL be
presented beside the username it belongs to.

Correcting a username SHALL preserve the account UUID, password, sessions,
profile, assignments, history, and outstanding one-time code. A code is bound
to the account, and preview after the correction SHALL show the current
username. An admin SHALL NOT use this path to change their own username.

#### Scenario: Username is read back before handover

- **WHEN** an admin provisions an account or reissues a code
- **THEN** the canonical username is shown beside the activation link

#### Scenario: A mistyped username is corrected in place

- **WHEN** an authorized admin corrects another account's username
- **THEN** the new username works, the old one does not, and the existing
  outstanding code still works with the new username

#### Scenario: A username already in use is refused

- **WHEN** an admin requests a username held by another account
- **THEN** the change is refused as unavailable and the old username remains
  unchanged

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

- **WHEN** a Franchise Admin loads People
- **THEN** usernames are present only for people wholly within their management
  authority and no account email is present

#### Scenario: A Super Admin sees another Super Admin's account email narrowly

- **WHEN** a Super Admin manages another live Super Admin
- **THEN** that target's account email is available for correction without
  exposing it to any outlet-scoped role

### Requirement: Every people surface answers whether a person can check in

People SHALL show, for each person, whether they can check in and where. Where
they cannot, the screen SHALL name the reason: the account is deactivated, the
person has no live assignment, or an activation link is outstanding. A missing
personal email or placeholder address SHALL never be an account state.

#### Scenario: A deactivated person reads as such

- **WHEN** People lists a person whose account is deactivated
- **THEN** the row states that they cannot sign in or check in

#### Scenario: An unactivated person shows the next step

- **WHEN** People lists a person with an outstanding activation link
- **THEN** the row states that activation is pending and offers the authorized
  admin action rather than asking for an email address

#### Scenario: A person with no assignment reads as unplaced

- **WHEN** People lists an active person with no live assignment
- **THEN** the row states that they cannot check in anywhere

#### Scenario: A working person reads as working

- **WHEN** People lists an active, activated person with live assignments
- **THEN** no problem is suggested and every assigned outlet is named

### Requirement: An activation link carries the code and asks for username plus a new password

The issuing surface SHALL offer an origin-relative activation link containing
the code as the only handover: a scannable image, the link itself, and one copy
action. The raw code SHALL NOT be separately displayed, and the URL SHALL carry
no username, provider alias, account email, or other personal detail.

Opening a live link SHALL resolve and display the current username, then ask
the person to type that username, a new password, and the repeated new password.
The code itself SHALL NOT be typed.

#### Scenario: Issuing a code produces one link handover

- **WHEN** an admin provisions or reissues
- **THEN** the panel offers the QR image, link, and copy action without exposing
  a separate raw code

#### Scenario: The image can be enlarged

- **WHEN** an admin taps the scannable image
- **THEN** it enlarges for another phone camera and can be dismissed

#### Scenario: The link contains no identity data

- **WHEN** an activation link is generated
- **THEN** its URL carries the code and no username, alias, or account email

#### Scenario: Opening the link presents three credential fields

- **WHEN** a person opens a valid activation link
- **THEN** the current username is shown and the form contains username, new
  password, and repeated new password

### Requirement: A code resolves to its username only for whoever holds that code

Activation SHALL offer a no-session lookup that resolves a live one-time code
to the current canonical username. The lookup SHALL NOT consume the code or
change the account, and SHALL return the same refusal for unknown, expired,
redeemed, superseded, and inactive-account codes.

The lookup SHALL return no provider alias, account email, role, outlet, name,
or account ID.

#### Scenario: A live code resolves to current username

- **WHEN** a lookup is made with a live code
- **THEN** the account's current canonical username is returned

#### Scenario: A lookup leaves the code redeemable

- **WHEN** a live code is previewed and then redeemed correctly
- **THEN** redemption succeeds because preview consumed nothing

#### Scenario: A dead code discloses nothing

- **WHEN** an unknown, expired, superseded, or redeemed code is previewed
- **THEN** the same refusal is returned and no identifier is disclosed

### Requirement: Activation shows and verifies the username before setting a password

Before accepting a password, activation SHALL show the current username and
instruct the person to type it into the username field. It SHALL NOT ask
whether the username is an email address or whether it belongs to them. An
equally reachable help path SHALL tell a person who does not recognize it to
ask the admin who issued the link to correct it.

#### Scenario: Typing the displayed username permits submission

- **WHEN** a person opens a valid link and types the displayed canonical
  username with matching valid passwords
- **THEN** the form may submit redemption

#### Scenario: A different username explains what to do

- **WHEN** a person submits a username different from the displayed current
  username
- **THEN** no code is consumed and the screen asks them to type the shown
  username or contact the issuing admin

#### Scenario: An unrecognized username has a help path

- **WHEN** the person says the displayed username is not the one they were
  given
- **THEN** they are told to ask the issuing admin for correction and no password
  is set

#### Scenario: A dead link fails before credential submission

- **WHEN** an expired, redeemed, superseded, or unknown link is opened
- **THEN** the screen offers no credential form and uses the uniform dead-link
  response

### Requirement: A new password is typed twice

Activation and admin-issued reset SHALL require the new password to be entered
twice and SHALL refuse to proceed unless the entries match. The client SHALL
decide a mismatch before any redemption or password-update request, so a
mistyped repeat consumes neither a code nor a rate-limit allowance.

#### Scenario: Mismatched entries are local

- **WHEN** a person submits two different new passwords
- **THEN** the mismatch is named, no network request is made, and the invite
  remains usable

#### Scenario: Matching entries activate the account

- **WHEN** activation receives the displayed username and matching valid
  passwords
- **THEN** the password is set and the client signs in through the ordinary
  username path

### Requirement: Sign-in asks for username or associated email

The sign-in screen SHALL identify the field as the username given by the
person's manager or the email associated with their account, SHALL show a
username example without an `@`, and SHALL route forgotten-password help
to an authorized Franchise Admin or Super Admin for every role.

#### Scenario: The identifier field explains what to enter

- **WHEN** a person opens sign-in
- **THEN** the identifier field asks for username or email, remains a text
  control with `autocomplete="username"`, and explains that email works only
  when associated with the account

#### Scenario: Help names the human reset path

- **WHEN** a person needs a password reset
- **THEN** sign-in help tells them to contact their Franchise Admin or Super
  Admin

## REMOVED Requirements

### Requirement: A placeholder address is visible, not silent

**Reason**: Staff email and placeholder Auth addresses no longer exist as
product data. A canonical admin-approved username exists before every account
is created or migrated.

**Migration**: The owner-reviewed username migration replaces every placeholder
with a valid unique username before completion. People replaces “needs an address”
with the existing activation-pending, deactivated, and unassigned states.

## RENAMED Requirements

- **FROM**: `Staff sign in with email and password`
- **TO**: `Every account signs in with username, and associated email is an alternate`
- **FROM**: `Redeeming a code sets a password and reveals nothing`
- **TO**: `Redeeming a code sets a password and reveals nothing beyond its username`
- **FROM**: `An admin-issued code is the password reset path`
- **TO**: `An admin-issued code is every role's password reset path`
- **FROM**: `An admin can see and correct the address an account signs in with`
- **TO**: `An admin can see and correct the username an account signs in with`
- **FROM**: `Staff email addresses are not readable from the counter tablet`
- **TO**: `Login identifiers and account emails stay off the counter tablet`
- **FROM**: `An activation link carries the code so nothing but a password is typed`
- **TO**: `An activation link carries the code and asks for username plus a new password`
- **FROM**: `A code resolves to its address only for whoever holds that code`
- **TO**: `A code resolves to its username only for whoever holds that code`
- **FROM**: `Activation confirms the address before a password is set`
- **TO**: `Activation shows and verifies the username before setting a password`
- **FROM**: `Sign-in names where the address came from`
- **TO**: `Sign-in asks for username or associated email`
