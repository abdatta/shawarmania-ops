# Identity And Access

## Purpose

Guarantees that the four roles exist in practice: every person signs in with an
admin-provisioned username account and lands on a shell for a role they
currently hold, an associated private email is an alternate sign-in identifier
when present and is required for every Super Admin, accounts are created and
reset by an admin handing over a single-use one-time link with no external
messaging service involved, and an account that is deactivated or reassigned
stops working immediately rather than at token expiry.
## Requirements

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

- **WHEN** an authorized Super Admin creates another Super Admin without an
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
as a deliverable address, or accepted from a product form. No authentication
message SHALL be delivered to it.

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
indistinguishable in the product. A request that receives no response from the
authentication backend SHALL instead report that the service could not be
reached and SHALL NOT imply that either credential was wrong.

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
- **THEN** no session is established and the screen explains that usernames
  do not include the at sign

#### Scenario: A wrong password is refused uniformly

- **WHEN** sign-in is attempted with an unknown username, and separately with a
  wrong password for a real username
- **THEN** both attempts produce the same username-or-password refusal

#### Scenario: A former unassociated email does not sign in

- **WHEN** a former address that was not retained in `account_emails` is
  submitted after migration
- **THEN** no session is established and the standard credential refusal is
  returned

#### Scenario: The authentication backend is unreachable

- **WHEN** sign-in receives no HTTP response because the backend cannot be reached
- **THEN** no session is established and the screen names the connection problem
  without saying whether the identifier or password is valid

#### Scenario: Activation cannot reach its backend

- **WHEN** activation receives no HTTP response from its backend
- **THEN** no code is consumed and the screen asks the person to check the
  connection and try again

### Requirement: Each role lands on a shell it holds an assignment for

After sign-in a session SHALL be routed to the shell of the highest role it
holds a live assignment for. A session SHALL be able to reach any role shell it
holds a live assignment for, and SHALL NOT be able to render one it cannot
reach — navigating there SHALL redirect it home.

A session holding the owner role SHALL additionally reach the outlet-level
manager shell, at every outlet, without holding an assignment at any of them.
Its authority there is the owner's own and is resolved by the database from the
owner role, so no assignment is written to grant it and none is required to use
it. What that authority stops short of does not change: the existing non-cash
boundary stands, so at an outlet they hold no assignment at the owner is offered
neither a day close nor a withdrawal, and the database refuses both.

Navigation SHALL be the union of the surfaces the session can reach, so that a
person who manages one outlet and works at another reaches both sets of surfaces
without switching anything.

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

#### Scenario: The owner reaches the manager shell unassigned

- **WHEN** a Super Admin holding no outlet assignment navigates to the
  outlet-level manager shell
- **THEN** it renders, scoped to an outlet they may see, rather than redirecting
  them home

#### Scenario: The owner's unassigned reach still stops at the drawer

- **WHEN** a Super Admin holding no assignment at an outlet opens that outlet's
  cash surface
- **THEN** the day is shown, neither a day close nor a withdrawal is offered,
  and both are refused by the database if attempted by a hand-crafted request

#### Scenario: A path for an unreachable role redirects

- **WHEN** a signed-in session navigates to the path of a role it can neither
  hold nor reach
- **THEN** it is redirected to its own home rather than rendering that shell

### Requirement: An unauthenticated visitor cannot reach a role shell

Role surfaces SHALL be reachable only with a session. An unauthenticated
request for a role surface SHALL be sent to sign-in, and after signing in the
person SHALL arrive at the surface they originally asked for.

#### Scenario: A deep link is preserved across sign-in

- **WHEN** an unauthenticated visitor opens a role surface URL and then signs in
- **THEN** they arrive at the originally requested surface, not a generic home

### Requirement: The application root resolves the session rather than greeting the visitor

The application root SHALL be a resolver, not a destination. It SHALL present no
description of the product and offer no navigation of its own, because the
operations origin serves only people who are trying to get into the app and the
product is described on its own separately hosted site.

The root SHALL act on the session state it has, and SHALL distinguish a session
that is absent from one that is merely not yet known:

- While the session is still being resolved, the root SHALL show the same
  loading placeholder the role shells show, and SHALL send nobody anywhere.
- Once resolved, the root SHALL take the session to the home of the highest role
  it holds.
- Once the absence of a session is **confirmed**, the root SHALL send the visitor
  to sign-in.
- When a session probably exists but could not be confirmed, the root SHALL say
  so and offer a retry, and SHALL NOT send anyone to sign-in.

A session whose state is unknown or unconfirmed SHALL NOT be treated as signed
out. Asking somebody to authenticate again for a session they already hold is a
refusal the app SHALL never make on the strength of an unanswered request.

The unauthenticated entry screen SHALL be the sign-in screen, and SHALL be
composed as a standalone screen rather than as content within a longer page.

A screen that establishes a session SHALL leave for its destination only once the
session reflects it, rather than as soon as the credentials are accepted. The two
are different moments, and navigating on the first reaches a root whose knowledge
of the session is still the one it had before.

#### Scenario: A signed-in visit to the root goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to the home of the highest role it holds, without any
  intermediate screen describing the product

#### Scenario: A confirmed signed-out visit reaches sign-in

- **WHEN** a visitor whose absence of a session has been confirmed opens the
  application root
- **THEN** they arrive at sign-in without an intervening screen to pass through

#### Scenario: An unresolved session waits rather than being sent anywhere

- **WHEN** the application root is opened and the session has not yet resolved
- **THEN** the loading placeholder is shown, and no navigation to sign-in or to
  a role shell has happened

#### Scenario: An unconfirmed session is not sent to sign-in

- **WHEN** the application root is opened, a stored session exists, and the
  request that would confirm it receives no response
- **THEN** the root states that the session could not be confirmed and offers a
  retry, and sign-in is not reached

#### Scenario: The root describes nothing

- **WHEN** the application root is opened with no session
- **THEN** no product description, marketing copy, or route other than the way
  in has been presented

#### Scenario: A completed sign-in does not return to sign-in

- **WHEN** credentials are accepted on the sign-in screen
- **THEN** the person arrives at their own shell, and is not returned to sign-in
  by a root acting on the session state that preceded it

### Requirement: The session is resolved once per visit, not once per screen

The real session SHALL be resolved by one holder shared across the screens that
need it, so that one visit asks who the person is once. Handing off from the
root to a role shell SHALL NOT re-resolve the session from nothing, and signing
in SHALL NOT require the destination to resolve it again.

That holder SHALL supply session state without deciding what is rendered: each
screen SHALL decide for itself what an unresolved session means for it, so that
screens which do not need a session, such as sign-in and activation, render
immediately rather than behind a placeholder.

The holder SHALL NOT be mounted above demo mode. Demo mode SHALL remain outside
its scope so that no real-session read occurs while fabricated data is on
screen.

#### Scenario: Opening the root resolves the session once

- **WHEN** a signed-in person opens the application root and is taken to their
  shell
- **THEN** the profile and assignments behind that session were read once for
  the visit, not once for the root and again for the shell

#### Scenario: Signing in does not re-resolve from nothing

- **WHEN** a person completes sign-in
- **THEN** the shell they arrive at already has the resolved session, without
  starting from an unresolved state

#### Scenario: The screens that need no session are not delayed by one

- **WHEN** sign-in or activation is opened while a session is still resolving
- **THEN** the form is rendered immediately rather than behind a loading
  placeholder

#### Scenario: Demo mode is outside the session holder

- **WHEN** any demo-mode path is rendered
- **THEN** no real session is resolved for it, and the demo-scope guard is not
  triggered

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

### Requirement: A one-time code is single-use, time-limited, and attempt-limited

Provisioning SHALL issue a one-time code that is shown to the issuing admin
exactly once and stored only as a hash. The code SHALL expire after a bounded
lifetime, SHALL be redeemable at most once, and repeated failed redemptions
SHALL be bounded at the redemption endpoint rather than per invite — because a
code that identifies its own invite gives a wrong guess no invite to charge.
Issuing a new code for an account SHALL supersede any outstanding code for that
account. At most one live code SHALL exist per account, and the database SHALL
guarantee that a live code identifies exactly one invite.

#### Scenario: The code is returned once and never stored in plain text

- **WHEN** an account is provisioned
- **THEN** the code is present in the response to the issuing admin, and the
  stored record holds only a hash of it

#### Scenario: A redeemed code cannot be redeemed again

- **WHEN** a valid code is redeemed successfully and then presented a second
  time
- **THEN** the second redemption is refused

#### Scenario: An expired code is refused

- **WHEN** a code is presented after its expiry
- **THEN** redemption is refused and no password is changed

#### Scenario: Repeated wrong codes are bounded by the endpoint

- **WHEN** wrong codes are presented repeatedly
- **THEN** the endpoint's rate limit refuses further attempts, and no
  legitimate outstanding code is disabled by another person's guessing

#### Scenario: A live code identifies exactly one invite

- **WHEN** any code hash is present on more than one live invite
- **THEN** the database refuses it, so redemption by code is never ambiguous

#### Scenario: Re-issuing supersedes the previous code

- **WHEN** an admin issues a new code for an account that already has an
  outstanding one
- **THEN** the previous code is no longer redeemable and only the new one works

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

### Requirement: A deactivated account loses its open session immediately

A running client SHALL detect that its own account has been deactivated without
waiting for a token to expire, SHALL end the session, and SHALL state why. The
database SHALL remain the enforcement boundary: a deactivated session reads and
writes nothing regardless of what the client does.

#### Scenario: An open app stops working when the account is deactivated

- **WHEN** an account is deactivated while that person's app is open
- **THEN** the app ends the session within a bounded interval and returns to
  sign-in stating that the account has been deactivated

#### Scenario: A deactivated account cannot sign back in usefully

- **WHEN** a deactivated person signs in with their still-correct password
- **THEN** they are returned to sign-in with the deactivation message rather
  than reaching a shell

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

### Requirement: Sessions persist across restarts for field use

A session SHALL survive closing and reopening the application, and SHALL be
refreshed automatically without user interaction for as long as it remains
valid. No inactivity timeout SHALL force routine re-authentication.

#### Scenario: The app reopens still signed in

- **WHEN** a signed-in person closes the application and reopens it later
- **THEN** they are still signed in and land on their role's home without
  entering a password

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

### Requirement: Signing out is reachable from every shell

Every role shell SHALL expose the signed-in person's name, role and outlet, and
a sign-out control, from its persistent chrome. After signing out the session
SHALL be gone, and returning to a role surface SHALL require signing in again.

#### Scenario: Sign out from any shell

- **WHEN** a signed-in person activates sign out from any role shell
- **THEN** the session ends and they are returned to the sign-in screen

#### Scenario: Demo mode offers no sign out

- **WHEN** a demo shell renders
- **THEN** no sign-out control is present, because no session exists to end

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
The code itself SHALL NOT be typed, and activation SHALL therefore offer no
field, form, or route for entering one. A code is a thing links carry, not a
thing people transcribe.

Activation opened without a code SHALL say that the link is incomplete and
SHALL offer the way to sign in. It SHALL NOT invite the person to supply the
missing code, because the issuing surface never shows them one to supply.

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

#### Scenario: Activation offers no way to type a code

- **WHEN** activation is opened without a code
- **THEN** no code field is present, the screen says the link is incomplete, and
  the way to sign in is offered

#### Scenario: No screen routes to activation without a code

- **WHEN** the sign-in screen is inspected for its routes onward
- **THEN** it offers no link to activation, and tells anybody without a password
  to ask an authorized admin for a one-time link

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

### Requirement: Redemption is rate-limited at the endpoint, and says so when it refuses

The redemption endpoint SHALL bound the rate of failed activation attempts, both
per client address and in total across all callers, over a rolling window.
Successful activations SHALL NOT count toward either bound, so ordinary
onboarding never consumes the budget.

The bound SHALL be enforced before any invite is examined. A refusal for
exceeding it SHALL be distinguishable from the uniform code refusal, because it
describes the caller rather than any account and therefore discloses nothing.

The stored record of an attempt SHALL NOT contain the client's address in
recoverable form.

#### Scenario: Failed attempts beyond the bound are refused

- **WHEN** failed activation attempts from one caller exceed the permitted
  number within the window
- **THEN** further attempts are refused without any invite being examined

#### Scenario: Being rate-limited is stated, not disguised as a bad code

- **WHEN** an activation attempt is refused for exceeding the rate limit
- **THEN** the response identifies rate limiting, distinctly from the refusal
  used for every code failure

#### Scenario: Successful activations do not consume the budget

- **WHEN** several people activate successfully in quick succession from one
  connection
- **THEN** none of those activations counts toward the rate limit

#### Scenario: The attempt record holds no readable address

- **WHEN** an attempt is recorded
- **THEN** the client address is stored only as a hash

### Requirement: An admin can see failed activations mounting

The count of failed activation attempts in the current window SHALL be readable
by a Super Admin, and SHALL be surfaced on the account-management surface when
it crosses a notice threshold. It SHALL NOT be readable by any other role.

#### Scenario: A burst of failures is visible to the owner

- **WHEN** failed activation attempts in the current window exceed the notice
  threshold and a Super Admin opens the account-management surface
- **THEN** the surface states that failed activations are unusually high

#### Scenario: The count is not readable by other roles

- **WHEN** a Franchise Admin, Biller or Employee requests the failed-activation
  count
- **THEN** the request is refused

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

### Requirement: The people model carries no payroll data

No salary, wage, address-for-payroll, or other payroll field SHALL exist in
the schema or the UI. Attendance is recorded because it feeds payroll done
outside the app; the money itself SHALL be recordable only as an ordinary
expense when the owner wants it in the books.

#### Scenario: No payroll columns anywhere

- **WHEN** the schema and every people surface are inspected
- **THEN** no salary or payroll field exists on any table or form

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

### Requirement: Biller is an Employee-capable assignment without becoming a second role

A live `biller` assignment SHALL confer the personal attendance and Employee
surface capabilities of an Employee at that outlet, in addition to eligibility to
hold a shift on its counter tablet. Promotion from Employee to Biller SHALL
replace the one assignment rather than create a second one.

#### Scenario: Biller signs in on a personal device
- **WHEN** a person with a Biller assignment signs in outside tablet context
- **THEN** they receive their own Employee attendance surfaces and no counter surface

#### Scenario: Employee is promoted
- **WHEN** an authorised admin promotes an Employee to Biller at the same outlet
- **THEN** one live Biller assignment remains, and their attendance history and personal login are unchanged

### Requirement: No account credential is ever accepted on a counter tablet

A counter tablet SHALL NOT accept a password, and SHALL NOT hold a human access
token, refresh token, identifier or associated email at any point. The only
account identifier it handles is the username submitted with a shift request,
which SHALL grant nothing on its own.

#### Scenario: The tablet is asked for a password
- **WHEN** any counter surface is reached on a set-up tablet
- **THEN** no password field exists on it, at setup or at shift opening

#### Scenario: An approved shift leaves no personal session
- **WHEN** an FA or SA approves their own shift request from their phone
- **THEN** the tablet's subsequent requests remain limited to its device session and cannot call personal or admin adapters

### Requirement: Eligibility is re-derived from the database at approval

Approving a shift request SHALL re-derive the approver's current assignments,
account state and outlet from the database, never from the request body or from
any claim in a token. An approval SHALL attribute the shift to the authenticated
approver only.

#### Scenario: Request body names another operator
- **WHEN** an approval names a different eligible person's ID
- **THEN** the function attributes the shift to the authenticated caller or refuses the request

#### Scenario: Assignment ended between request and approval
- **WHEN** the person's assignment ends after the request is created and before it is approved
- **THEN** approval is refused and no shift opens
