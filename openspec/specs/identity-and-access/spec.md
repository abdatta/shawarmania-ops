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

### Requirement: An activation link carries the code so nothing but a password is typed

The surface that issues a one-time code SHALL offer an activation link
containing that code, suitable for sending over an ordinary messaging app, and
SHALL offer it as the **only** handover: a scannable image of the link, the link
itself, and one action to copy it. The raw code SHALL NOT be displayed as a
separate thing to pass on, so that there is one way to hand access over rather
than a choice between several.

The link SHALL be built from the running deployment's own origin and base path,
so it is correct under a sub-path deployment and under a custom domain without a
code change. The link SHALL NOT contain the email address or any other personal
detail.

Opening the link SHALL carry the code into activation, so the only thing the
person types is a password.

#### Scenario: Issuing a code produces a link that carries it

- **WHEN** an admin provisions an account or re-issues a code
- **THEN** the panel offers a scannable image of the activation link, the link
  itself, and a way to copy it

#### Scenario: The code is not offered as a separate handover

- **WHEN** an admin views a freshly issued handover
- **THEN** the one-time code is not presented on its own to be dictated or
  copied apart from the link

#### Scenario: The scannable image can be enlarged for another camera

- **WHEN** an admin taps the scannable image
- **THEN** it is shown at a size another phone can read across a counter, and
  can be dismissed back to the panel

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

### Requirement: A new password is typed twice

Activation SHALL require the new password to be entered twice and SHALL refuse
to proceed unless the two entries match. The refusal SHALL name the mismatch,
and SHALL be decided by the client before any request is made — so a mistyped
repeat costs neither a rate-limit allowance nor the one-time code.

The password is typed blind, once, with no way back: a typo sets a password
nobody knows, spends the code proving it, and leaves the person needing a new
one from an admin before they can try again.

#### Scenario: Mismatched entries are refused without consuming anything

- **WHEN** a person enters two different passwords and submits
- **THEN** they are told the two do not match, no request is made, and the code
  remains redeemable

#### Scenario: Matching entries activate the account

- **WHEN** a person enters the same password in both fields and submits
- **THEN** the password is set and they are signed in

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

### Requirement: A person's name is never blank

A roster row and an app account SHALL each carry a non-empty full name,
enforced by the database and not only by a form. A name consisting entirely of
whitespace SHALL be refused.

A name is the only field on either record that a human reads to know who the
record is about. A staff code disambiguates two people with the same name; it
does not identify a person with no name at all. The same reasoning that made a
blank staff code unacceptable applies with more force to the name beside it.

The surface that writes the record SHALL refuse before writing and SHALL name
the field that is missing, on the Staff surface and on the account-provisioning
surface alike.

#### Scenario: A roster row cannot be created without a name

- **WHEN** an admin submits the Staff form with the full name empty or
  containing only spaces
- **THEN** no roster row is created, and the form says which field is missing

#### Scenario: An account cannot be provisioned without a name

- **WHEN** an admin submits the provisioning form with the full name empty or
  containing only spaces
- **THEN** no account is created, no one-time code is issued, and the form says
  which field is missing

#### Scenario: The database refuses a blank name whatever the client sends

- **WHEN** any caller inserts or updates a roster row or a profile whose full
  name is empty or entirely whitespace, including by a request that bypasses
  the form
- **THEN** the database refuses the write

#### Scenario: An existing person cannot be edited into a nameless one

- **WHEN** an admin edits a roster row and clears the full name
- **THEN** the write is refused and the row keeps the name it had

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

