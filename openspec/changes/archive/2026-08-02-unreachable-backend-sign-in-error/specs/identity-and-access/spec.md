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
- **THEN** no session is established and the standard credential refusal is returned

#### Scenario: The authentication backend is unreachable

- **WHEN** sign-in receives no HTTP response because the backend cannot be reached
- **THEN** no session is established and the screen names the connection problem
  without saying whether the identifier or password is valid

#### Scenario: Activation cannot reach its backend

- **WHEN** activation receives no HTTP response from its backend
- **THEN** no code is consumed and the screen asks the person to check the
  connection and try again
