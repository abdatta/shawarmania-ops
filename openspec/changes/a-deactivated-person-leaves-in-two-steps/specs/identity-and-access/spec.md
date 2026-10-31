## MODIFIED Requirements

### Requirement: Usernames are canonical and unique across the business

Every human account that has not left SHALL have one canonical username shared
by all of that person's roles and outlet assignments. Input SHALL be trimmed and
lowercased before validation. The canonical username SHALL be 3–30 ASCII
characters drawn only from `a`–`z`, `0`–`9`, period, and underscore. It SHALL
NOT begin or end with a period or contain consecutive periods. An `@` prefix,
internal whitespace, hyphen, or any other character SHALL be refused at the
privileged identity boundary.

Username uniqueness SHALL be case-insensitive and business-wide among accounts
that have not left. The system MAY suggest and lowercase a username before
submission, but it SHALL NOT silently choose a different available value after
the admin submits.

When a person is marked as left, their username SHALL be released: their Auth
alias SHALL move outside the reserved sign-in domain, so the username can never
again sign in to the left account and is available to any new or existing
account.

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

#### Scenario: A left person's username is given to someone else

- **WHEN** `rahul.k` was marked as left and an admin adds a new person with the
  username `rahul.k`
- **THEN** the new account is created with `rahul.k`, and signing in as
  `rahul.k` reaches only the new account

### Requirement: Accounts are provisioned by an admin, never self-registered

Account creation SHALL be an administrative action performed through a
privileged server-side function that holds the service-role credential.
Self-service registration SHALL be disabled and the service-role credential
MUST NOT be reachable from the browser.

For every outlet-scoped role, provisioning SHALL accept one or more outlets
and SHALL create one live assignment for the selected role at each outlet
before issuing one activation code.

The admin SHALL supply name, canonical username, role and outlets. Phone, job
title, and joined date SHALL remain optional. The privileged function SHALL
NOT provision a Super Admin; owner access is created only in the database
(see *Owner access is granted and removed only in the database*).

#### Scenario: An admin creates an ordinary account at several outlets

- **WHEN** an authorized admin submits a name, username, Employee role, and
  several permitted outlets without an email
- **THEN** one Auth account and profile are created, one live Employee
  assignment exists at every selected outlet, and one activation link is
  returned after all assignments exist

#### Scenario: Add person offers no owner role

- **WHEN** the owner opens Add person
- **THEN** the role list offers Franchise Admin, Biller and Employee, and no
  Super Admin

#### Scenario: A hand-crafted Super Admin provisioning is refused

- **WHEN** the owner's own session sends a provisioning request with the Super
  Admin role
- **THEN** no account, profile, assignment, account email, or invite is created

#### Scenario: Self-registration is refused

- **WHEN** anyone attempts to register an account directly against the
  authentication service
- **THEN** the attempt is refused

### Requirement: Provisioning authority is re-derived from the caller's token

A privileged account function SHALL determine the caller's assignments from the
caller's own verified session, never from values supplied in the request. A
Super Admin MAY provision, re-issue, and deactivate any account other than
their own and other than an account holding a live Super Admin assignment. A
Franchise Admin MAY provision Biller and Employee accounts only when every
requested outlet is one at which the caller holds a live Franchise Admin
assignment, and MAY re-issue, deactivate or mark as left only where every
outlet the target person is assigned to is one they manage. Every other
combination SHALL be refused.

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

- **WHEN** a Franchise Admin attempts to deactivate, re-issue a code for, or
  mark as left a person who also holds a live assignment at an outlet they do
  not manage
- **THEN** the request is refused, because the account is not theirs alone to
  act on

#### Scenario: A Biller or Employee cannot provision at all

- **WHEN** a Biller or an Employee calls a privileged account function
- **THEN** the request is refused

#### Scenario: An admin cannot deactivate themselves

- **WHEN** an admin requests deactivation of their own account
- **THEN** the request is refused and the account stays active

#### Scenario: The owner cannot deactivate another owner from the app

- **WHEN** the owner's session hand-crafts a deactivation of another account
  holding a live Super Admin assignment
- **THEN** the request is refused and the account stays active

### Requirement: An assignment change takes effect atomically without ending the session

An authorized edit SHALL apply the person's editable facts and complete intended live assignment set as one transaction. Unchanged assignments SHALL retain their identity and start date; a role change or transfer SHALL end the former assignment and insert the replacement without deleting or rewriting history. A failed validation or write SHALL leave profile facts, assignments, active state, account email, and invitations unchanged.

An assignment change while the person's app is open SHALL take effect at the database immediately and the client SHALL reflect it within a bounded interval without password entry or token reissue. Ordinary editing SHALL NOT deactivate sign-in and SHALL NOT accept an empty intended assignment set.

When the target has a live activation link, the assignment transaction SHALL supersede it and return a replacement only after the final assignment set exists. An assignment change SHALL NOT replace a password-reset link and SHALL NOT create an unsolicited link.

An edit SHALL NOT add or remove a Super Admin assignment: an intended set that adds one the target does not hold, or omits one they do, SHALL be refused as a whole. A target's existing Super Admin assignment and private email SHALL be carried through an edit unchanged, and the final-Super-Admin guard SHALL remain.

#### Scenario: Employee is promoted without interruption

- **WHEN** an authorized admin changes an Employee assignment to Biller at the same outlet
- **THEN** one live Biller assignment remains, the Employee assignment is historically ended, and the account, password, active state, attendance, and open session remain intact

#### Scenario: A person transfers outlets atomically

- **WHEN** an authorized admin changes a single assignment from one outlet to another
- **THEN** no observable committed state contains neither or both unintended placements, and history retains the ended former assignment

#### Scenario: A new assignment appears without signing out

- **WHEN** a person is granted an assignment at a second outlet while their app is open
- **THEN** the second outlet becomes available within the revalidation interval without sign-out or password re-entry

#### Scenario: An invalid intended set changes nothing

- **WHEN** any role, outlet, authority, final-owner, email, stale-state, or uniqueness validation fails
- **THEN** no profile fact, assignment, active state, account email, or invitation changes

#### Scenario: Activation follows the final placement

- **WHEN** an assignment edit affects a person with a live activation link
- **THEN** the old link is superseded within the transaction and one replacement setup link is shown after the final assignment set exists

#### Scenario: Reset survives a placement change

- **WHEN** an assignment edit affects an established person with a live password-reset link
- **THEN** that reset link remains redeemable and no replacement is issued

#### Scenario: An edit that grants owner access is refused

- **WHEN** the owner's session hand-crafts an edit whose intended set adds a Super Admin assignment to a Biller
- **THEN** the complete edit is refused and nothing changes

#### Scenario: Editing an owner keeps their owner access

- **WHEN** the owner edits another owner's name and phone
- **THEN** the change commits and the target's Super Admin assignment and private email are unchanged

### Requirement: Admins manage accounts from a task-based surface scoped to their authority

The Super Admin SHALL have a Team surface listing accounts across all outlets.
The Franchise Admin SHALL have one listing every person holding a live assignment
at an outlet they manage, and SHALL be offered account tasks, usernames and
account status only for the accounts they are permitted to manage; a listed
person they may not manage SHALL be shown without a username or tasks, stating
that the owner manages that account.

Team SHALL list active people in its main list and deactivated people who have
not left in a separate collapsed section, **Deactivated (n)**, stating each
one's deactivation day where it is recorded. A person who has left SHALL NOT be
listed.

An active person's menu SHALL offer recognizable tasks: Edit, Change username,
Set up account or Reset password according to lifecycle state, Change sign-in
email where permitted, and Deactivate. A deactivated person's menu SHALL offer
Edit, Reactivate and Mark as left. A person holding a live Super Admin
assignment SHALL be offered no Deactivate, Reactivate or Mark as left.

Edit SHALL contain personal facts and authorized placement. It SHALL show one outlet and one access role for a single ordinary assignment, and SHALL progressively reveal assignment rows through a control labelled “Works at multiple outlets”. A person already holding several or mixed-role ordinary assignments SHALL open in the expanded form. The control and **Add outlet** SHALL be offered only when the reader could add an outlet the person does not already hold. Editing a person whose only assignment is Super Admin SHALL show no outlet assignment section. Edit SHALL offer no control that grants or removes owner access and no departure control. Username SHALL remain a separate credential action.

A newly issued handover SHALL be presented once through one reusable purpose-aware component with a prominent QR, primary copy action, highlighted username, one-use and expiry facts, and only warnings relevant to that state. It SHALL NOT be retrievable afterwards.

#### Scenario: The common edit is simple

- **WHEN** an admin edits a person with one ordinary outlet assignment
- **THEN** the initial form shows their facts, one outlet, and one access role without separate grant/end actions or an expanded assignment list

#### Scenario: Multi-outlet editing is disclosed deliberately

- **WHEN** the admin selects Works at multiple outlets or edits a person who already has several assignments
- **THEN** one row per outlet is shown with its single role and permitted add/remove controls

#### Scenario: A one-outlet manager is offered no outlet to add

- **WHEN** a Franchise Admin who manages one outlet edits an Employee there
- **THEN** the form shows the outlet and role, and neither Works at multiple outlets nor Add outlet

#### Scenario: Editing an owner shows no outlets

- **WHEN** the owner edits another person whose only assignment is Super Admin
- **THEN** the form shows their name, phone and job title, no outlet section, no Add outlet and no warning about adding an outlet, and Save succeeds

#### Scenario: The Franchise Admin list and controls are authority-scoped

- **WHEN** a Franchise Admin opens Team or hand-crafts an edit
- **THEN** they can switch Employee and Biller only at outlets they manage and cannot grant, alter, or remove Franchise Admin or Super Admin authority

#### Scenario: A person who also works elsewhere is listed and not managed

- **WHEN** a person holds a live Employee assignment at an outlet a Franchise Admin
  manages and another at an outlet they do not, and that Franchise Admin opens
  Team
- **THEN** the person is listed with the assignment the Franchise Admin can see,
  no username and no tasks, and the row states that the owner manages the account

#### Scenario: A deactivated person moves to Deactivated

- **WHEN** a manager deactivates an Employee on 12 October
- **THEN** the Employee leaves the main list and appears under Deactivated (1) reading Deactivated · 12 Oct, still visible to that manager, with Edit, Reactivate and Mark as left

#### Scenario: An owner's row cannot be switched off

- **WHEN** the owner opens the menu on another owner's row
- **THEN** it offers Edit, Change username, the hand-over action and Change sign-in email, and no Deactivate

#### Scenario: The handover is concise and purpose-aware

- **WHEN** an admin issues account setup and separately issues password reset
- **THEN** the same visual component presents the same QR/copy/security facts with distinct setup or reset headings and no misleading “New code” label

### Requirement: Departure and access are independent and departure is explicit

The people model SHALL keep whether an account may sign in and where the person works as independent facts. Deactivating an account SHALL end its open session immediately without ending assignments, and SHALL record the Asia/Kolkata business day of the deactivation on the account; reactivating SHALL clear it. Editing assignments SHALL leave active state untouched.

A person leaves the business only through an explicit Mark as left action, offered and accepted only for an account already deactivated. That action SHALL require confirmation and, in one transaction, end every live assignment without deleting history, dated by the recorded deactivation day (or, where none is recorded, the current Kolkata day) and never before the assignment's own start, and clear the person's phone. The person's username SHALL then be released. Removing the final row in ordinary Edit SHALL NOT silently invoke departure.

#### Scenario: The panic button does not falsify placement

- **WHEN** an admin deactivates the account of someone currently assigned
- **THEN** the session ends immediately, the day is recorded, and every assignment and attendance fact remains

#### Scenario: Reactivating restores the person as they were

- **WHEN** an admin reactivates a deactivated person who has not left
- **THEN** they can sign in again with their password, hold the same assignments and roles, and carry no deactivation day

#### Scenario: Ordinary editing cannot mark someone as left

- **WHEN** an admin edits outlet or role fields
- **THEN** no default checkbox or empty assignment set deactivates the account or ends every placement

#### Scenario: An active person cannot be marked as left

- **WHEN** an authorized admin hand-crafts Mark as left for an active account
- **THEN** the request is refused and nothing changes

#### Scenario: Mark as left is dated by the deactivation

- **WHEN** a person was deactivated on 12 June and an authorized admin confirms Mark as left on 30 October
- **THEN** every live assignment ends on 12 June, the phone is cleared, the username is released, and every historical row remains readable

#### Scenario: An assignment started after the deactivation ends the day it began

- **WHEN** a deactivated person was given an assignment starting 20 June and is marked as left on 30 October with a deactivation day of 12 June
- **THEN** that assignment ends on 20 June, and every other live assignment ends on 12 June

### Requirement: Assignment transitions use the Kolkata calendar

Every atomic assignment-set edit SHALL derive its assignment end date from Asia/Kolkata inside the database transaction. Every deactivation SHALL record its day from the Asia/Kolkata calendar computed by the database. Mark as left SHALL take its end date from that recorded day, or, where none is recorded, from Asia/Kolkata inside the transaction. All assignments ended by one transition SHALL receive the same date, except that none SHALL be dated before its own start date.

The transition date SHALL NOT be accepted from the browser or derived from the database session's UTC calendar. Existing complete-set authority, atomicity, history-retention, final-Super-Admin, private-email, and account-active-state invariants SHALL remain enforced.

#### Scenario: Assignment edit crosses Kolkata midnight before UTC

- **WHEN** an authorized admin changes an assignment after midnight in Kolkata while UTC is still on the previous date
- **THEN** the former assignment ends on the Kolkata date, the replacement starts validly, and the complete edit commits atomically

#### Scenario: Deactivation crosses Kolkata midnight before UTC

- **WHEN** an authorized admin deactivates an account during the Kolkata/UTC calendar gap
- **THEN** the recorded deactivation day is the Kolkata date

#### Scenario: Client cannot choose the historical end date

- **WHEN** a caller invokes any account-transition command
- **THEN** the database derives the date itself and accepts no client-supplied assignment end date or deactivation day

### Requirement: Assignment authority covers current and intended states

A Super Admin SHALL be able to edit another person's outlet assignments across all outlets and the Franchise Admin, Biller and Employee roles. No caller SHALL grant, end or alter a Super Admin assignment through this administrative path; owner access is changed only in the database. No caller SHALL edit their own assignments through this administrative path.

A Franchise Admin SHALL be able to switch Employee and Biller and add, transfer, or remove those roles only at outlets they manage. They SHALL NOT grant, alter, or remove a Franchise Admin or Super Admin assignment. Authorization SHALL inspect both the target's complete current assignment set and intended set; invisible or out-of-scope assignments SHALL NOT be treated as removable omissions.

#### Scenario: FA promotes staff at a managed outlet

- **WHEN** a Franchise Admin changes an Employee to Biller at an outlet they manage
- **THEN** the change succeeds without affecting account access

#### Scenario: FA cannot demote an administrator

- **WHEN** a Franchise Admin attempts to alter another Franchise Admin or any Super Admin through UI or a hand-crafted request
- **THEN** the complete request is refused and nothing changes

#### Scenario: SA cannot remove owner access from the app

- **WHEN** a Super Admin hand-crafts an edit or an end-assignment request that would end another Super Admin's assignment
- **THEN** the complete request is refused and nothing changes

#### Scenario: Final SA cannot be removed

- **WHEN** any request would leave no live Super Admin assignment
- **THEN** the database refuses the complete transaction

#### Scenario: Self-demotion is refused

- **WHEN** an admin hand-crafts an assignment-set edit for their own account
- **THEN** the privileged boundary refuses it

## ADDED Requirements

### Requirement: Owner access is granted and removed only in the database

No application surface and no privileged account function SHALL grant, end,
deactivate, reactivate or mark as left a Super Admin assignment or an account
holding one. The account function SHALL refuse each such request, whoever sends
it, including a provisioning, assignment, end-assignment, edit, set-active or
departure request. Granting and removing owner access SHALL be a written
database procedure, run as the service role, that keeps the private-email and
final-Super-Admin invariants. Changing a Super Admin's private sign-in email
from Team SHALL remain available.

#### Scenario: Team offers no owner grant

- **WHEN** the owner edits any person on Team
- **THEN** no control grants or removes owner access

#### Scenario: Each hand-crafted owner change is refused

- **WHEN** the owner's own session sends, in turn, a provision with the Super
  Admin role, an assign with the Super Admin role, an end-assignment of a Super
  Admin assignment, a set-active on an owner, and a Mark as left on an owner
- **THEN** each is refused and no account, assignment or active state changes

#### Scenario: The database procedure grants owner access

- **WHEN** the procedure grants owner access to an existing Franchise Admin with
  a private email
- **THEN** they hold a live Super Admin assignment and their next session lands
  on the owner's shell
