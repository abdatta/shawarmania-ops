# Identity And Access

## Purpose

Guarantees that the four roles exist in practice: every person signs in with an
admin-provisioned email account and lands on their own role's shell, accounts
are created and reset by an admin handing over a single-use one-time code with
no external messaging service involved, and an account that is deactivated or
reassigned stops working immediately rather than at token expiry.

## Requirements

### Requirement: Staff sign in with email and password

The application SHALL authenticate people with an email address and a password.
Phone numbers SHALL NOT be used as a credential or as a sign-in identifier. No
SMS provider and no outbound mail SHALL be required for any part of
authentication.

#### Scenario: A provisioned account signs in

- **WHEN** a person with an active account enters their email address and
  correct password on the sign-in screen
- **THEN** a session is established and they are taken to their own role's home
  surface

#### Scenario: A wrong password is refused

- **WHEN** a sign-in is attempted with an incorrect password
- **THEN** no session is established and the screen states that the email or
  password is wrong, without revealing which

#### Scenario: Sign-in requires no external messaging service

- **WHEN** any authentication flow runs — sign-in, provisioning, activation, or
  password reset
- **THEN** no SMS is sent, no email is sent, and no external messaging provider
  is contacted

### Requirement: Each role lands on its own shell

After sign-in a session SHALL be routed to the role shell named by its own
role claim. A session SHALL NOT be able to render another role's shell by
navigating to that role's path.

#### Scenario: All four roles reach their own shell

- **WHEN** a Super Admin, a Franchise Admin, a Biller, and an Employee each
  sign in
- **THEN** each lands on their own role's home surface with that role's
  navigation

#### Scenario: A mistyped role path redirects

- **WHEN** a signed-in session navigates to another role's path
- **THEN** it is redirected to its own role's home rather than rendering the
  other shell

#### Scenario: A signed-in visit to the landing page goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to its own role's home rather than shown the
  unauthenticated landing page

### Requirement: An unauthenticated visitor cannot reach a role shell

Role surfaces SHALL be reachable only with a session. An unauthenticated
request for a role surface SHALL be sent to sign-in, and after signing in the
person SHALL arrive at the surface they originally asked for.

#### Scenario: A deep link is preserved across sign-in

- **WHEN** an unauthenticated visitor opens a role surface URL and then signs in
- **THEN** they arrive at the originally requested surface, not a generic home

### Requirement: Accounts are provisioned by an admin, never self-registered

Account creation SHALL be an administrative action performed through a
privileged server-side function that holds the service-role credential. Self-
service registration SHALL be disabled. The created account SHALL have its
email address pre-confirmed, so no confirmation message is ever sent. The
service-role credential MUST NOT be reachable from the browser.

#### Scenario: An admin creates an account

- **WHEN** an admin submits a name, email, role, and outlet for a new person
- **THEN** an account is created with the email pre-confirmed, a profile
  carrying that role and outlet exists, and a one-time code is returned to the
  admin

#### Scenario: Self-registration is refused

- **WHEN** anyone attempts to register an account directly against the
  authentication service
- **THEN** the attempt is refused

### Requirement: Provisioning authority is re-derived from the caller's token

A privileged account function SHALL determine the caller's role and outlet from
the caller's own verified session, never from values supplied in the request. A
Super Admin MAY provision, re-issue, and deactivate any account other than
their own. A Franchise Admin MAY do so only for Biller and Employee accounts in
their own outlet. Every other combination SHALL be refused.

#### Scenario: A Franchise Admin cannot provision outside their outlet

- **WHEN** a Franchise Admin requests an account in another outlet
- **THEN** the request is refused and no account is created

#### Scenario: A Franchise Admin cannot create an administrator

- **WHEN** a Franchise Admin requests a Super Admin or Franchise Admin account
- **THEN** the request is refused and no account is created

#### Scenario: A Biller or Employee cannot provision at all

- **WHEN** a Biller or an Employee calls a privileged account function
- **THEN** the request is refused

#### Scenario: An admin cannot deactivate themselves

- **WHEN** an admin requests deactivation of their own account
- **THEN** the request is refused and the account stays active

### Requirement: A one-time code is single-use, time-limited, and attempt-limited

Provisioning SHALL issue a one-time code that is shown to the issuing admin
exactly once and stored only as a hash. The code SHALL expire after a bounded
lifetime, SHALL be redeemable at most once, and SHALL be refused after a
bounded number of failed attempts. Issuing a new code for an account SHALL
supersede any outstanding code for that account.

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

#### Scenario: Repeated wrong codes exhaust the invite

- **WHEN** the permitted number of failed attempts is exceeded for an invite
- **THEN** further redemption is refused even if the correct code is presented,
  until an admin issues a new one

#### Scenario: Re-issuing supersedes the previous code

- **WHEN** an admin issues a new code for an account that already has an
  outstanding one
- **THEN** the previous code is no longer redeemable and only the new one works

### Requirement: Redeeming a code sets a password and reveals nothing

Redemption SHALL accept an email address, a code, and a new password, and SHALL
require no existing session. It SHALL enforce a minimum password length. Every
failure mode — unknown address, wrong code, expired code, already-redeemed
code, exhausted attempts, inactive account — SHALL produce an identical
response, so that no request can distinguish a real account from an absent one.
Redemption SHALL NOT return a session; the person signs in afterwards with the
password they just set.

#### Scenario: First-run activation

- **WHEN** a newly provisioned person enters their email, their one-time code,
  and a new password
- **THEN** the password is set, the code is consumed, and they can sign in with
  it

#### Scenario: Failures are indistinguishable

- **WHEN** redemption is attempted with an unknown email address, and separately
  with a known address and a wrong code
- **THEN** both attempts produce the same response

#### Scenario: A too-short password is refused before anything is consumed

- **WHEN** redemption is attempted with a password below the minimum length
- **THEN** it is refused and the code remains redeemable

### Requirement: An admin-issued code is the password reset path

Password reset SHALL be admin-initiated: an admin issues a new one-time code
for the account, and the person redeems it exactly as at first run. Self-
service password reset SHALL NOT be offered.

#### Scenario: A person who forgot their password is reset by an admin

- **WHEN** an admin re-issues a code for an existing account and the person
  redeems it with a new password
- **THEN** the new password works and the previous password does not

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

### Requirement: A role or outlet reassignment ends the open session

When a session's stored role or outlet no longer matches the role and outlet
carried by its access token, the client SHALL attempt one token refresh, and
SHALL end the session with an explanation if the mismatch persists. A client
MUST NOT render a shell for a role its token does not carry.

#### Scenario: A reassigned user is signed out rather than shown the wrong shell

- **WHEN** a person's role or outlet is changed while their app is open and a
  token refresh does not resolve the mismatch
- **THEN** the session ends with a message that their role has changed, and no
  shell for the new role is rendered on the old token

#### Scenario: Reassignment invalidates outstanding codes

- **WHEN** a person's role or outlet is changed while an unredeemed code exists
  for them
- **THEN** that code is no longer redeemable

### Requirement: Sessions persist across restarts for field use

A session SHALL survive closing and reopening the application, and SHALL be
refreshed automatically without user interaction for as long as it remains
valid. No inactivity timeout SHALL force routine re-authentication.

#### Scenario: The app reopens still signed in

- **WHEN** a signed-in person closes the application and reopens it later
- **THEN** they are still signed in and land on their role's home without
  entering a password

### Requirement: Admins manage accounts from a surface scoped to their authority

The Super Admin SHALL have a surface listing accounts across all outlets, and
the Franchise Admin SHALL have one listing accounts in their own outlet only.
Both SHALL support creating an account, re-issuing a code, and deactivating or
reactivating an account, within the authority limits of the caller's role. A
newly issued code SHALL be displayed once for the admin to pass on, and SHALL
NOT be retrievable afterwards.

#### Scenario: The Franchise Admin's list is outlet-scoped

- **WHEN** a Franchise Admin opens the account surface
- **THEN** only their own outlet's accounts are listed, and no control offers a
  role or outlet outside their authority

#### Scenario: The code is shown once

- **WHEN** an admin provisions an account or re-issues a code
- **THEN** the code is displayed for them to copy, and revisiting the surface
  does not show it again

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
