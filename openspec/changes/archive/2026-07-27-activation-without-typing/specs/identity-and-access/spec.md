## ADDED Requirements

### Requirement: An activation link carries the code so nothing but a password is typed

The surface that issues a one-time code SHALL also offer an activation link
containing that code, suitable for sending over an ordinary messaging app. The
link SHALL be built from the running deployment's own origin and base path, so
it is correct under a sub-path deployment and under a custom domain without a
code change. The link SHALL NOT contain the email address or any other personal
detail.

Opening the link SHALL carry the code into activation, so the only thing the
person types is a password.

#### Scenario: Issuing a code produces a link that carries it

- **WHEN** an admin provisions an account or re-issues a code
- **THEN** the issued-code panel offers an activation link containing that code,
  alongside the code itself

#### Scenario: The link contains no address

- **WHEN** an activation link is generated for any account
- **THEN** the URL carries the code and carries no email address

#### Scenario: Opening the link asks only for a password

- **WHEN** a person opens a valid activation link
- **THEN** activation proceeds without asking for an email address or a code,
  and a password is the only field they complete

### Requirement: A code resolves to its address only for whoever holds that code

Activation SHALL offer a lookup that resolves a one-time code to the email
address the account will sign in with, requiring no session. The lookup SHALL
NOT consume the code, SHALL NOT change any account, and SHALL return the same
refusal as redemption for every code that is not live — unknown, expired,
already redeemed, superseded, or belonging to a deactivated account.

This discloses nothing beyond what the caller already holds: possession of a
live single-use code for that specific account is required before any address is
returned.

#### Scenario: A live code resolves to its address

- **WHEN** a lookup is made with a live, unexpired, unredeemed code
- **THEN** the address that account will sign in with is returned

#### Scenario: A lookup leaves the code redeemable

- **WHEN** a lookup is made with a live code and the code is afterwards redeemed
- **THEN** redemption succeeds, because the lookup consumed nothing

#### Scenario: A code that is not live discloses nothing

- **WHEN** a lookup is made with an unknown, expired, superseded or
  already-redeemed code
- **THEN** the same refusal is returned in every case and no address is disclosed

### Requirement: Activation confirms the address before a password is set

Before accepting a password, activation SHALL show the address the account will
sign in with and SHALL require an explicit affirmative confirmation from the
person. The screen SHALL offer an equally reachable way to say the address is
not theirs, and that path SHALL tell them what to do — ask the admin who issued
the code, who can correct it.

Activation SHALL NOT ask the person to retype the address.

#### Scenario: Confirming the address reveals the password field

- **WHEN** a person opens a valid activation link and confirms the address shown
  is theirs
- **THEN** the password field is presented

#### Scenario: Denying the address explains what to do next

- **WHEN** a person opens a valid activation link and states the address is not
  theirs
- **THEN** no password field is presented and they are told to ask their manager
  to correct the address and issue a new code

#### Scenario: A dead link fails before anything is typed

- **WHEN** a person opens an activation link whose code is expired, already
  redeemed, superseded or unknown
- **THEN** the screen says the link is not usable and offers no password field,
  without the person having typed anything

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

### Requirement: Sign-in names where the address came from

The sign-in screen SHALL tell the person which address to use, in terms they can
act on — the address they gave the admin who created their account.

#### Scenario: The email field says which address is meant

- **WHEN** a person opens the sign-in screen
- **THEN** the email field is accompanied by guidance naming it as the address
  they gave their manager

## MODIFIED Requirements

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

### Requirement: Redeeming a code sets a password and reveals nothing

Redemption SHALL accept a code and a new password, SHALL derive the account from
the code, and SHALL require no existing session and no email address. It SHALL
enforce a minimum password length. Every code-related failure mode — unknown
code, expired code, already-redeemed code, superseded code, inactive account —
SHALL produce an identical response, so that no request can distinguish a real
account from an absent one. Redemption SHALL NOT return a session; the person
signs in afterwards with the password they just set.

#### Scenario: First-run activation

- **WHEN** a newly provisioned person opens their activation link, confirms the
  address, and chooses a password
- **THEN** the password is set, the code is consumed, and they can sign in with
  it

#### Scenario: Failures are indistinguishable

- **WHEN** redemption is attempted with an unknown code, and separately with an
  expired one
- **THEN** both attempts produce the same response

#### Scenario: A too-short password is refused before anything is consumed

- **WHEN** redemption is attempted with a password below the minimum length
- **THEN** it is refused, the refusal names the password as the problem, and the
  code remains redeemable

#### Scenario: An address is neither required nor accepted as a key

- **WHEN** redemption is attempted
- **THEN** no email address is required, and the account acted on is the one the
  code identifies

### Requirement: A role or outlet reassignment ends the open session

A client SHALL attempt one token refresh when its stored role or outlet no
longer matches the role and outlet carried by its access token, and SHALL end
the session with an explanation if the mismatch persists. A client MUST NOT
render a shell for a role its token does not carry.

#### Scenario: A reassigned user is signed out rather than shown the wrong shell

- **WHEN** a person's role or outlet is changed while their app is open and a
  token refresh does not resolve the mismatch
- **THEN** the session ends with a message that their role has changed, and no
  shell for the new role is rendered on the old token

#### Scenario: Reassignment invalidates outstanding codes

- **WHEN** a person's role or outlet is changed while an unredeemed code exists
  for them
- **THEN** that code is no longer redeemable
