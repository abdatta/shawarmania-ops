## MODIFIED Requirements

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
- **THEN** redemption is refused and People no longer treats the account as having a live handover

#### Scenario: Repeated wrong codes are bounded

- **WHEN** wrong codes are presented repeatedly
- **THEN** the endpoint rate limit refuses further attempts without disabling a legitimate code through another person's guesses

#### Scenario: Replacement supersedes the same handover

- **WHEN** an admin replaces a live activation or password-reset handover
- **THEN** the former code is no longer redeemable and only the newly displayed code works

### Requirement: Redeeming a code sets a password and establishes a verified replacement session

Redemption SHALL accept a code, the canonical username displayed by that code, and a new password. It SHALL derive the account from the code, require no existing session, enforce the minimum password length, and consume the code only if the supplied username matches the account's current username.

Unknown, expired, already-redeemed, superseded, and inactive-account codes SHALL produce an identical response. A canonical username mismatch SHALL produce a specific correction response and SHALL NOT consume the code.

After a successful password change, the client SHALL discard any superseded local human session, sign in through the ordinary username/password path, verify that newly returned session with the Auth server, update the shared session holder, and navigate only after the holder reflects it. Failure to establish the replacement session SHALL leave the password changed and direct the person to ordinary sign-in without rendering a protected shell from stale state.

#### Scenario: First-run activation enters with the new session

- **WHEN** a newly provisioned person redeems an activation link with the displayed username and matching valid new passwords
- **THEN** the password is set, the code is consumed, and the app enters only after the ordinary sign-in path establishes and verifies the new session

#### Scenario: Password reset replaces stale local state

- **WHEN** a signed-in device redeems a password-reset link for its own account
- **THEN** any former local human session is discarded and the app uses only the newly established verified session

#### Scenario: Post-redemption sign-in fails

- **WHEN** the password update succeeds but the replacement session cannot be established
- **THEN** the app states that the password changed, offers ordinary sign-in, and renders no authenticated-looking shell

#### Scenario: Dead-code failures are indistinguishable

- **WHEN** redemption is attempted with an unknown code and separately with an expired code
- **THEN** both attempts produce the same response

#### Scenario: A username typo preserves the link

- **WHEN** a live code is submitted with a canonical username other than the one it currently identifies
- **THEN** the response names the username mismatch and the same code remains redeemable

### Requirement: An admin-issued link is every role's activation and password-reset path

For Franchise Admins, Billers, Employees, and Super Admins, forgotten-password recovery SHALL be admin-initiated: an authorized admin issues a one-time password-reset link and the person redeems it with the displayed username and a new password typed twice. A never-activated account SHALL instead receive a set-up/activation link. One Super Admin MAY issue the link for another Super Admin. This change SHALL NOT offer self-service forgotten-password recovery or send authentication mail.

A deactivated account SHALL be reactivated before either link can be issued. The handover SHALL identify its purpose without requiring the admin to interpret the word “code”.

#### Scenario: A staff member who forgot their password gets reset help

- **WHEN** an authorized admin selects Reset password for an established Employee and the person redeems the link
- **THEN** the new password works, the previous password does not, other superseded personal sessions cease to authorize, and no mail or SMS is sent

#### Scenario: A new person is offered setup

- **WHEN** an authorized admin opens actions for a person who has never successfully signed in
- **THEN** the action says Set up account rather than Reset password

#### Scenario: A deactivated person gets no unusable link

- **WHEN** an admin asks to issue a link for a deactivated account
- **THEN** issuance is refused until the account is explicitly reactivated

#### Scenario: Sign-in offers no email-recovery control

- **WHEN** any role opens sign-in help after forgetting a password
- **THEN** they are told to ask an authorized admin and no recovery-address field is offered

### Requirement: An assignment change takes effect atomically without ending the session

An authorized edit SHALL apply the person's editable facts and complete intended live assignment set as one transaction. Unchanged assignments SHALL retain their identity and start date; a role change or transfer SHALL end the former assignment and insert the replacement without deleting or rewriting history. A failed validation or write SHALL leave profile facts, assignments, active state, account email, and invitations unchanged.

An assignment change while the person's app is open SHALL take effect at the database immediately and the client SHALL reflect it within a bounded interval without password entry or token reissue. Ordinary editing SHALL NOT deactivate sign-in and SHALL NOT accept an empty intended assignment set.

When the target has a live activation link, the assignment transaction SHALL supersede it and return a replacement only after the final assignment set exists. An assignment change SHALL NOT replace a password-reset link and SHALL NOT create an unsolicited link.

Granting Super Admin SHALL require and atomically preserve the private-email invariant. Ending a Super Admin assignment SHALL retain the private email, and the final-Super-Admin guard SHALL remain.

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

### Requirement: Admins manage accounts from a task-based surface scoped to their authority

The Super Admin SHALL have a People surface listing accounts across all outlets, and the Franchise Admin SHALL have one listing only accounts they are permitted to manage. A person's menu SHALL offer recognizable tasks: Edit, Change username, Set up account or Reset password according to lifecycle state, Change sign-in email where permitted, and Deactivate or Reactivate.

Edit SHALL contain personal facts and authorized placement. It SHALL show one outlet and one access role for a single ordinary assignment, and SHALL progressively reveal assignment rows through a control labelled “Works at multiple outlets”. A person already holding zero, several, or mixed-role assignments SHALL open in the expanded form. Username SHALL remain a separate credential action.

A newly issued handover SHALL be presented once through one reusable purpose-aware component with a prominent QR, primary copy action, highlighted username, one-use and expiry facts, and only warnings relevant to that state. It SHALL NOT be retrievable afterwards.

#### Scenario: The common edit is simple

- **WHEN** an admin edits a person with one ordinary outlet assignment
- **THEN** the initial form shows their facts, one outlet, and one access role without separate grant/end actions or an expanded assignment list

#### Scenario: Multi-outlet editing is disclosed deliberately

- **WHEN** the admin selects Works at multiple outlets or edits a person who already has several assignments
- **THEN** one row per outlet is shown with its single role and permitted add/remove controls

#### Scenario: The Franchise Admin list and controls are authority-scoped

- **WHEN** a Franchise Admin opens People or hand-crafts an edit
- **THEN** they can switch Employee and Biller only at outlets they manage and cannot grant, alter, or remove Franchise Admin or Super Admin authority

#### Scenario: The handover is concise and purpose-aware

- **WHEN** an admin issues account setup and separately issues password reset
- **THEN** the same visual component presents the same QR/copy/security facts with distinct setup or reset headings and no misleading “New code” label

### Requirement: An admin can see and correct the username an account signs in with

The current canonical username SHALL be visible to admins who may manage the account and correctable by them through a separate action. Correcting a username SHALL preserve the account UUID, password, open and refresh sessions, profile, assignments, history, and outstanding one-time link. A link is bound to the account, and preview after correction SHALL show the current username. An admin SHALL NOT use this path to change their own username.

#### Scenario: A mistyped username is corrected in place

- **WHEN** an authorized admin corrects another account's username
- **THEN** the new username works, the old one does not, and the existing outstanding link still works with the new username

#### Scenario: An open session survives correction

- **WHEN** an account with an open session has its username corrected
- **THEN** the open session remains authorized without sign-in while future authentication accepts only the new username

#### Scenario: A username already in use is refused

- **WHEN** an admin requests a username held by another account
- **THEN** the change is refused as unavailable and the old username remains unchanged

### Requirement: Every People surface states account readiness truthfully

People SHALL derive status from active state, successful sign-in history, live assignments, and a live unexpired handover purpose. A pending password reset SHALL NOT make an established account read as awaiting activation, and an expired invitation SHALL NOT create a pending status.

#### Scenario: A deactivated person reads as such

- **WHEN** People lists a person whose account is deactivated
- **THEN** the row states Deactivated regardless of historical invitation rows

#### Scenario: A new account is awaiting setup

- **WHEN** a person has never successfully signed in and has a live activation link
- **THEN** the row states that setup is pending and offers Replace setup link

#### Scenario: An established account has reset pending

- **WHEN** a person has successfully signed in before and has a live password-reset link
- **THEN** the row remains active and states Password reset issued

#### Scenario: Expiry removes pending status

- **WHEN** the only unused link is expired
- **THEN** People does not describe that link as pending and offers the appropriate fresh setup or reset action

#### Scenario: A person with no assignment reads as unplaced

- **WHEN** People lists an active person with no live assignment
- **THEN** the row states that they are not assigned to an outlet

### Requirement: Departure and access are independent and departure is explicit

The people model SHALL keep whether an account may sign in and where the person works as independent facts. Deactivating an account SHALL end its open session immediately without ending assignments. Editing assignments SHALL leave active state untouched.

A person leaves the business only through an explicit Mark as left action. That action SHALL require confirmation, end every live assignment without deleting history, and deactivate sign-in in one transaction. Removing the final row in ordinary Edit SHALL NOT silently invoke departure.

#### Scenario: The panic button does not falsify placement

- **WHEN** an admin deactivates the account of someone currently assigned
- **THEN** the session ends immediately and every assignment and attendance fact remains

#### Scenario: Ordinary editing cannot mark someone as left

- **WHEN** an admin edits outlet or role fields
- **THEN** no default checkbox or empty assignment set deactivates the account or ends every placement

#### Scenario: Mark as left is one deliberate transition

- **WHEN** an authorized admin confirms Mark as left
- **THEN** all live assignments end, sign-in is deactivated, and every historical row remains readable

### Requirement: Assignment authority covers current and intended states

A Super Admin SHALL be able to edit another person's assignments across all outlets and roles, including promoting or demoting another Super Admin or Franchise Admin, subject to private-email and final-Super-Admin invariants. No caller SHALL edit their own assignments through this administrative path.

A Franchise Admin SHALL be able to switch Employee and Biller and add, transfer, or remove those roles only at outlets they manage. They SHALL NOT grant, alter, or remove a Franchise Admin or Super Admin assignment. Authorization SHALL inspect both the target's complete current assignment set and intended set; invisible or out-of-scope assignments SHALL NOT be treated as removable omissions.

#### Scenario: FA promotes staff at a managed outlet

- **WHEN** a Franchise Admin changes an Employee to Biller at an outlet they manage
- **THEN** the change succeeds without affecting account access

#### Scenario: FA cannot demote an administrator

- **WHEN** a Franchise Admin attempts to alter another Franchise Admin or any Super Admin through UI or a hand-crafted request
- **THEN** the complete request is refused and nothing changes

#### Scenario: SA demotes another SA safely

- **WHEN** a Super Admin moves another Super Admin to permitted outlet-scoped assignments while at least one Super Admin remains
- **THEN** the transition succeeds, preserves the target's private email, and changes no historical records

#### Scenario: Final SA cannot be removed

- **WHEN** any request would leave no live Super Admin assignment
- **THEN** the database refuses the complete transaction

#### Scenario: Self-demotion is refused

- **WHEN** an admin hand-crafts an assignment-set edit for their own account
- **THEN** the privileged boundary refuses it

### Requirement: Biller is an Employee-capable assignment without becoming a second role

A live Biller assignment SHALL confer personal attendance and Employee surface capabilities at that outlet, plus eligibility to hold a shift on its counter tablet. One person SHALL hold at most one live role at an outlet, so Employee and Biller SHALL be offered as alternatives rather than simultaneous selections.

#### Scenario: Biller signs in on a personal device

- **WHEN** a person with a Biller assignment signs in outside tablet context
- **THEN** they receive their Employee attendance surfaces and no counter surface

#### Scenario: Employee is promoted

- **WHEN** an authorized admin promotes an Employee to Biller at the same outlet
- **THEN** one live Biller assignment remains and attendance history, personal login, password, and active session are unchanged

#### Scenario: Same-outlet roles cannot be stacked

- **WHEN** a UI or hand-crafted request attempts to retain Employee and Biller simultaneously at one outlet
- **THEN** the request is refused

## ADDED Requirements

### Requirement: Confirmed invalid sessions end while uncertain sessions wait

Every protected human-session request SHALL distinguish three outcomes: a missing, malformed, expired, revoked, or Auth-rejected credential is unauthenticated; a verified caller without permission is forbidden; and a request whose backend did not answer is indeterminate. The Edge boundary SHALL return an authentication failure distinct from an authorization refusal.

A server-confirmed invalid session SHALL clear local human credentials and shared resolved state and reach sign-in with a short session-ended explanation. Deactivation SHALL retain its specific explanation. A timeout, offline state, fetch failure, or unanswered profile lookup SHALL preserve the stored session, show a retryable connection state, and SHALL NOT send the person to sign-in. Counter-device sessions retain their separate lifecycle.

#### Scenario: Expired human session returns to sign-in

- **WHEN** Auth definitively rejects the credential used by a protected human action
- **THEN** the server reports an authentication failure, the client clears that session, and sign-in says the session ended

#### Scenario: Verified caller lacks authority

- **WHEN** Auth verifies the caller but their live assignments do not permit the action
- **THEN** the server reports forbidden and the client does not mislabel it as an expired session

#### Scenario: Offline does not destroy a session

- **WHEN** a stored session cannot be confirmed because the request receives no response
- **THEN** the client preserves it, offers retry, and does not reach sign-in
