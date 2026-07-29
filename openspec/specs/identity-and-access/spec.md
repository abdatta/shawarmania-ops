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

### Requirement: Each role lands on a shell it holds an assignment for

After sign-in a session SHALL be routed to the shell of the highest role it
holds a live assignment for. A session SHALL be able to reach any role shell it
holds a live assignment for, and SHALL NOT be able to render one it does not —
navigating there SHALL redirect it home.

Navigation SHALL be the union of the surfaces every live assignment entitles
the person to, so that a person who manages one outlet and works at another
reaches both sets of surfaces without switching anything.

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

#### Scenario: A path for an unheld role redirects

- **WHEN** a signed-in session navigates to the path of a role it holds no live
  assignment for
- **THEN** it is redirected to its own home rather than rendering that shell

#### Scenario: A signed-in visit to the landing page goes to the app

- **WHEN** a signed-in session opens the application root
- **THEN** it is taken to its own home rather than shown the unauthenticated
  landing page

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

A privileged account function SHALL determine the caller's assignments from the
caller's own verified session, never from values supplied in the request. A
Super Admin MAY provision, re-issue, and deactivate any account other than
their own. A Franchise Admin MAY do so only for Biller and Employee accounts at
outlets they hold a live Franchise Admin assignment at, and only where every
outlet the target person is assigned to is one they manage. Every other
combination SHALL be refused.

#### Scenario: A Franchise Admin cannot provision outside their outlets

- **WHEN** a Franchise Admin requests an account at an outlet they hold no live
  assignment at
- **THEN** the request is refused and no account is created

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

### Requirement: An assignment change takes effect without ending the session

An assignment granted or ended while a person's app is open SHALL take effect
at the database immediately, and the open client SHALL reflect it within a
bounded interval without the person signing in again — because nothing about
authority is carried in the token, there is nothing to reissue.

A client SHALL NOT render a shell or a surface for a role it holds no live
assignment for. A person who loses every live assignment SHALL be returned to a
state that offers no outlet surfaces and states why.

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

#### Scenario: Reassignment invalidates outstanding codes

- **WHEN** a person's assignments change while an unredeemed code exists for
  them
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

### Requirement: A person is created once, as an account

Creating a staff member SHALL be one act on one surface: the admin supplies the
person's name, address, phone, role, outlet, and optionally a job title, and
the result is a single record that is simultaneously their login and their
staff-list membership, together with the assignment that places them. No
separate roster write, link step, or second surface SHALL exist anywhere in the
UI.

The person's job title (`role_title`) lives on the account record; where they
work and from when lives on the assignment. Editing the job title SHALL be done
by the admin's own session under Row-Level Security — a Super Admin for any
account, a Franchise Admin for people assigned to an outlet they manage — while
identity and access fields (active state, email) and assignments themselves
remain governed by their own boundaries.

#### Scenario: One step creates a working person

- **WHEN** an admin creates a person in the Employee role at an outlet with a
  name, address, and job title
- **THEN** one create action yields an account, a live assignment at that
  outlet, and a one-time activation code; the person appears on that outlet's
  staff list immediately, and no linking step exists or is needed before they
  can check in once activated

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

### Requirement: Every people surface answers whether a person can check in

The People surface SHALL show, for each person, whether they can check in and
where, and where they cannot, the reason SHALL be readable on the screen — the
account is deactivated, the person holds no live assignment, or the account has
never been activated (no usable address yet, or an invite still outstanding) —
so that the question is answerable during a phone call without anyone opening
the database.

#### Scenario: A deactivated person reads as such

- **WHEN** the People surface lists a person whose account is deactivated
- **THEN** the row states the account is deactivated and cannot sign in or
  check in

#### Scenario: An unactivated person shows what is missing

- **WHEN** the People surface lists a person who has never activated — a
  placeholder address or an outstanding invite
- **THEN** the row states what is missing and the next step, not merely that
  something is wrong

#### Scenario: A person with no assignment reads as unplaced

- **WHEN** the People surface lists an active, activated person holding no live
  assignment
- **THEN** the row states that they are not assigned to any outlet and cannot
  check in anywhere

#### Scenario: A working person reads as working

- **WHEN** the People surface lists an active, activated person with at least
  one live assignment
- **THEN** nothing on the row suggests a problem, and every outlet they are
  assigned to is named

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

### Requirement: A placeholder address is visible, not silent

An account whose address is a migration placeholder SHALL be visibly marked
on the People surface as needing a real address — a placeholder being one
that cannot receive anything — and the fix SHALL be the existing
address-correction path followed by issuing a code. Nothing SHALL send
anything to a placeholder address, because no code exists for such an
account until an admin has replaced it.

#### Scenario: A migrated person's address asks to be fixed

- **WHEN** the People surface lists an account carrying a placeholder address
- **THEN** the row is marked as needing an address before the person can be
  invited, and correcting it then issuing a code makes the account usable

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
