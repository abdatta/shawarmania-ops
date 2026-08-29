# Roles And Permissions

> The policies exist and are enforced (`data-model-and-tenancy`), all four roles sign in against them (`auth-and-roles`), and since `counter-devices-and-offline` the counter tablet is a machine principal with a real setup path and a real shift — see [Counter tablet](#counter-tablet--setup--the-two-device-shift).

Four roles. The governing rule: **a role's scope is enforced by Row-Level Security in Postgres, and the UI merely reflects it.** If the two ever disagree, the database is right and the UI is a bug.

## Authority is an assignment

Since `multi-outlet-people` (#22) a person's authority is not a pair of columns
on their account. It is a set of **assignments** — one row per person per role
per outlet — and every policy answers by membership in that set: *does this
person hold the right assignment at this row's outlet?*

Three consequences, and each is load-bearing:

- **One person, one login, however many outlets.** A staffer splitting shifts
  across Kalyani and Kanchrapara holds two assignments and signs in once.
  Account-per-outlet stays rejected (owner, 2026-07-28).
- **Nothing about authority is in the token** (owner, 2026-07-29). There are no
  role claims to reissue, so granting or ending an assignment bites at the next
  request — the way deactivation already does.
- **Nothing is session-scoped.** No active role, no "acting as", no switcher.
  The owner rejected that sketch on 2026-07-29 as needless complexity for
  people who are not technical. Where a screen needs one outlet, it asks on the
  screen; that selection carries no authority and does not outlive the surface.

An assignment is **ended by a date, never deleted**, because rows written under
it have to stay explicable. Leaving one outlet is therefore not leaving the
business: a person has left when they hold no live assignment anywhere, which
is derived rather than stored. Start and end dates follow the Asia/Kolkata
calendar inside the database transition itself; the server's UTC date is never
allowed to make a just-started assignment end on the previous day.

## The roles

| Role | Scope | Device | Primary job |
|---|---|---|---|
| **Super Admin** | All outlets | Own phone | Runs the business; compares outlets; manages outlets and admins |
| **Franchise Admin** | An outlet they are assigned to | Own phone | Runs one shop; menu, stock, expenses, cash, staff |
| **Biller** | An outlet they are assigned to | Shared counter tablet | Rings up customers |
| **Employee** | Own records only | Own phone | Marks attendance |

A person may hold more than one of these, at different outlets. They land in
the shell of the highest role they hold, and their navigation is the union of
what those assignments entitle them to — nothing to switch between.

**The Super Admin reaches every outlet's manager surfaces without being
assigned to one** (`owner-reaches-every-outlet`, #28). Running every outlet is
what the role is, and the policies have always answered it that way: every
outlet-scoped policy carries an owner branch, and the attendance guard reads
"an admin here" as *the owner, or a manager at this outlet*. Until #28 the
shell asked a narrower question — which roles do you **hold** — so the owner had
to grant themselves a manager assignment at each outlet to see its attendance,
which is authority they already had. Nothing is written to `assignments` to
reach these surfaces, and a navigation entry keeps the reader in their own
shell rather than reading as though they had become the manager.

**Reaching a surface confers nothing.** What the owner may write there is still
the database's answer.

**The drawer is the deliberate exception, and it was decided on its own merits.**
`cash-is-counted-not-closed` (#11) grants a Super Admin every outlet's drawer
while holding no assignment there. The old rule refused it, on the premise that a
cash count is a claim by whoever counted the cash — and that premise is intact;
the inference was wrong. **The person who counts the cash at these outlets is the
owner.** Both Super Admins additionally had their Franchise Admin rows *deleted*
rather than ended on 2026-08-01, so under the previous rule the database would
have refused everybody the primary action, at both outlets, on day one.

What replaces the refusal is evidence rather than prohibition: every drawer record
carries whether the account was inside that outlet's geofence, a reason is
required and stored where it was not, and **no drawer action is refused for being
recorded elsewhere.** A collector who enters every count from home shows up as a
column of reasons, which is oversight a refusal would not have produced.

**The owner who runs a shop** is still assigned as its Franchise Admin, and
writes there like any manager — including the drawer. That authority comes from
the assignment rather than from being the owner, which is exactly why it stops
at that outlet, and it is the reason the carve-out below survives #28.

**Self-assignment** is refused, with one deliberate carve-out: a Super Admin
may place *themselves* at an outlet. The principle behind it is the owner's
(2026-07-29): **a Super Admin should be able to do everything standalone** —
needing a second owner present to perform an act is a dependency the business
does not want, and it holds whether the business has one owner or five.

The carve-out is safe because it cannot widen anything: an outlet role confers
less than the owner role already does, `super_admin` stays refused as a
self-grant for everybody, and the last live Super Admin assignment stays
unremovable — so no owner can strand the business by acting alone either.
**Nobody, ever, may grant themselves the `super_admin` role** — the only
self-grant that widens what a person can do — and the last live Super Admin
assignment cannot be ended by anyone, including its holder.

## Capability matrix

`✓` full · `R` read-only · `—` no access · `self` own records only

| Capability | Super Admin | Franchise Admin | Biller | Employee |
|---|---|---|---|---|
| **Outlets** |
| View outlet list | ✓ all | R own | — | — |
| Create / edit / deactivate outlet | ✓ | — | — | — |
| Delete an outlet | ✓ closed, and only while nothing references it | — | — | — |
| **People** |
| Manage Franchise Admins | ✓ other accounts only | — | — | — |
| Manage Billers and Employees | ✓ other accounts only | ✓ only when every current and intended outlet is managed by the caller | — | — |
| Edit a person's facts and complete assignment set | ✓ any permitted role/outlet on another account | ✓ Employee/Biller only at every managed current and intended outlet | — | — |
| Mark a person as left | ✓ other accounts only | ✓ Biller/Employee only at every managed current outlet | — | — |
| Deactivate / reactivate an account | ✓ other accounts only | ✓ Biller/Employee only at every managed current outlet | — | — |
| Issue setup or password-reset handover | ✓ other accounts only | ✓ Biller/Employee only at every managed current outlet | — | — |
| See / correct username | ✓ managed accounts; own username read-only | ✓ managed Biller/Employee accounts; own username read-only | — | — |
| Set up / remove counter tablet | ✓ | ✓ own outlet | — | — |
| **Menu** |
| View menu | R all | ✓ own outlet | R own outlet | — |
| Add / edit / disable items and prices | ✓ | ✓ own outlet | — | — |
| **Billing** |
| Create a bill | — | — | ✓ own outlet | — |
| View bills | R all | R own outlet | R own shift | — |
| Void a bill | ✓ | ✓ own outlet | — | — |
| **Customers** (business-wide, see below) |
| Retrieve a customer by their **complete** phone | — | — | ✓ | — |
| Save a customer from a sale | — | — | ✓ | — |
| Browse, search by prefix, or count the directory | — | — | — | — |
| Read the directory | ✓ | — | — | — |
| Edit or delete a customer | — | — | — | — |
| **Inventory** |
| View stock and low-stock warnings | R all | ✓ own outlet | — | — |
| Record movements | — | ✓ own outlet | — | — |
| **Expenses** |
| View | R all | ✓ own outlet | — | — |
| Record | — | ✓ own outlet | — | — |
| Use or mint a category while recording | when recording is allowed | when recording is allowed | when recording is allowed | when recording is allowed |
| Rename, merge or retire categories | ✓ | — | — | — |
| **Attendance** |
| Appear on an outlet's attendance day | only if also staff there | only if also staff there | — | ✓ |
| Check in | — | only if also staff there | — | ✓ self |
| Enter attendance for someone (past time, today) | ✓ any outlet | ✓ own outlet | — | — |
| View attendance | R all | ✓ own outlet | — | R self |
| Override a failed geofence check | ✓ | ✓ own outlet | — | — |
| Correct a settled check-in time (audited) | ✓ any outlet | ✓ own outlet | — | — |
| **Cash drawer** (#11) |
| Read the drawer and its counts | ✓ any outlet | ✓ own outlets | — | — |
| Record a count | ✓ any outlet | ✓ own outlets | — | — |
| Record a collection or a spend | ✓ any outlet | ✓ own outlets | — | — |
| Edit the most recent count | ✓ any outlet | ✓ own outlets | — | — |
| Adjust a count a later one anchored on | ✓ any outlet | ✓ own outlets | — | — |
| Acknowledge a late arrival | ✓ any outlet | ✓ own outlets | — | — |
| **Ledger statement** (#11) |
| Read a day or a month | ✓ any outlet | ✓ own outlets | — | — |
| Verify a day | ✓ any outlet | ✓ own outlets | — | — |
| Type any figure on it | — | — | — | — |
| **Profit and loss** |
| View outlet P&L | R all | R own outlet | — | — |
| Compare outlets | ✓ | — | — | — |
| **Alerts** |
| Raise an alert | — | ✓ own outlet | — | — |
| View and respond | ✓ all | R own alerts | — | — |
| **Manual ledger** (temporary, #36) |
| Read a day or a month | ✓ all | R own outlets | — | — |
| Record and correct days | ✓ all | ✓ own outlets | — | — |
| Read the outlet's expenses | ✓ all | ✓ own outlets | R own outlet | R own outlet |
| Record an expense | ✓ all | ✓ own outlets, any date | ✓ own outlet, today | ✓ own outlet, today |
| Correct or withdraw an expense | ✓ all | ✓ own outlets | own rows, today | own rows, today |
| Delete an expense | — | — | — | — |

**Expense categories are business-wide suggestions, not authority.** Any active
account that is allowed to record an expense now, or will be allowed by the live
expense writer set, may use an existing suggestion or mint a normalised new one
as part of that write. Seeing the shared list does not reveal an expense row or
widen outlet access. Only a Super Admin may curate the vocabulary: rename, merge
and retire run through database functions that re-derive that authority from the
caller's session, and rename or merge records an immutable operation with the
number of historical rows moved.

**Customers are the one thing here that is not an outlet's.** One normalized
phone identifies one customer for the whole business, so a returning customer is
recognised at either counter (`global-customer-identity`, #32). That makes the
row a business-wide list of personal data, and the access above is drawn to
match: a counter may resolve a **complete** phone and nothing else, because a
lookup is a question about somebody the customer just identified themselves as,
while a browse would be the directory itself. Nobody holds `select` on the
table — not a manager, not a device, not the owner — so the refusals above are
the absence of a grant rather than a policy that could be widened by accident,
and repeated lookups are rate-bounded per caller. **A customer id widens
nothing**: knowing it opens that customer's bills only at outlets the caller
could already read, which `supabase/tests/20_global_customer_identity.sql`
proves with a hand-crafted request. Editing a profile is nobody's capability
today, deliberately — see [Limitations](LIMITATIONS.md).

**Deleting an outlet is the only delete anybody has.** Every other record in the system is voided, deactivated or corrected — the database grants `DELETE` to no client role on any other table. The exception is bounded by a precondition Postgres enforces rather than the screen: an outlet goes only while nothing anywhere references it, so one that ever traded cannot be deleted at all. It is for a shop created by mistake, and the app offers it only after the outlet is marked closed, so the reversible action always comes first.

**Attendance is recorded for staff, and a manager is not staff.** An outlet's
attendance day lists the people holding a live **Employee or Biller** assignment
there. A Biller counts because a Biller works a shift at the shop and therefore
turns up to it: their assignment already confers personal attendance, and
`attendance_submit_attempt` has always accepted either role, so listing Employees
alone made a person promoted from Employee to Biller vanish from the day they
were promoted. A
Franchise Admin or Super Admin appears only when they hold one too — which is
exactly the case where their attendance is a real thing. Nobody records a
manager's arrival, and a roll-call that listed them was a list to read past. The
day additionally keeps a row for **anybody who already has a record on it**,
whatever they hold: the waiting counts are computed from rows, so a row inside a
count and outside the screen would be a badge nobody could clear. A person off
the staff list appears only on the day their record belongs to, and not in the
by-person view, where a range of days for somebody whose days are not tracked
would be a pattern of nothing.

**The drawer survives the owner's reach.** Cash closing and withdrawals are
granted only by a live Franchise Admin assignment at that outlet, so the owner
reaching an outlet's cash surface still gets the figures and neither write; the
screen says whose they are rather than leaving it to be discovered by refusal.
**`cash-is-counted-not-closed` (#11) settles this for the drawer**: a Super Admin
records observations, collections, spends and adjustments at every outlet, and
each record carries whether they were inside that outlet's geofence, with a
reason required and stored where they were not. A drawer write is never refused
for distance.

**The manual ledger's two tables answer differently, and the difference is the
point.** The **day record** reaches owners and managers and stops: no outlet
staff branch exists on any verb, at any outlet, including their own. That is a
stronger claim than ordinary outlet isolation and is asserted directly in
`supabase/tests/21_manual_ledger.sql` rather than inherited from the cross-outlet
sweep, with `supabase/tests/01_schema_coverage.sql` pinning the absence of a
staff predicate as a catalog fact so a later migration fails by name.

It protects two different things. On the **write** side, the drawer: an account
that could set the counted cash, the opening cash or the cash removed could make
any drawer reconcile, and the nightly count is the only control the business has
over cash. On the **read** side, history and aggregates — any past business date,
any month's total, the other outlet, and every figure net of commission, none of
which can be observed from behind a counter. It does **not** protect the takings
of a shift somebody worked at the outlet they worked it in; see
[Limitations](LIMITATIONS.md) for why the system does not claim that, and why the
policy refuses that row anyway.

The **expense record** is the opposite: everyone at the outlet reads every row,
whoever recorded it, so the surface can show at a glance which rows are yours to
fix. Staff record against the outlet's current business day only and correct or
withdraw only their own rows while that day is still running; both limits are the
guard's, because both need the outlet's own cutover. A manager or the owner
reaches any row on any date, which is what makes the freeze a routing rule rather
than a dead end.

**Nobody deletes an expense.** The grant is revoked and a trigger refuses it, so
a row goes only by being withdrawn: it stays visible, struck through, naming who
withdrew it and when. A reason is optional (owner, 2026-08-09) — the moment and
the account answer what the trace exists for, and demanding a sentence on the
fastest correction path collects a column of "mistake". **A fabricated cash
expense is not caught by the drawer count**, because an invented expense lowers
expected cash and the count still matches; the controls are attribution and the
withdrawal trace, not the count.

**The owner writing cash figures there is not precedent for the drawer.** It is
allowed only because no real cash record exists yet to corrupt, and the bound in
the paragraph above is untouched by it. See
[Limitations](LIMITATIONS.md#the-manual-ledger-is-a-stopgap-with-a-stated-exit)
for the capability's stated exit, which belongs to `retire-the-manual-ledger`
(#12).

Two deliberate asymmetries worth noting. **The Super Admin cannot create bills** — billing is a counter action tied to a set-up tablet and a live shift, and letting the owner ring up a sale from their phone would corrupt attribution and cash reconciliation. **The Biller only sees their own shift's bills**, not the outlet's whole history; reviewing the day is a manager's job, and it keeps a shared tablet from exposing the outlet's takings to whoever is standing at it.

## Authentication

### Human accounts — username or associated email + password

Every role signs in with one admin-chosen, business-wide username and a
password they set themselves. Usernames normalize to lowercase, contain 3–30
ASCII letters, digits, periods or underscores, and never begin/end with a
period or contain consecutive periods. They are typed without `@`. If a
private email is associated with the account, the person may instead use that
email with the same password.

Supabase Auth remains the password/session authority. Because it has no
first-class username field, the canonical username is encoded internally as
`<username>@login.shawarmania.invalid`. That reserved Auth alias is
non-deliverable provider plumbing, never a staff email and never product copy.
The browser derives it and calls Supabase password Auth directly for username
sign-in. Associated-email sign-in uses a narrow Edge Function so the private
email-to-alias mapping never reaches the browser. That function applies hashed
abuse limits, uses a request-local public-key Supabase client for the password
grant, and returns only Supabase session tokens; it does not verify, retain, or
log the password or mint a custom session.

Sign-in remains enumeration-safe when it fails. An unknown username, an
unknown or unassociated email, and a wrong password all show the same refusal.
Only positive evidence that the browser received no Auth response produces
connection guidance; provider wording is never inspected or shown. Activation
uses the same transport distinction, and a connection failure does not consume
the one-time code.

Accounts are **admin-provisioned**: an admin enters name, username, role and
role-appropriate outlets; phone, title and joining date remain optional. Only
a Super Admin additionally requires a real account email. The system creates
the profile, every selected assignment, that private Super Admin email when
applicable, and one invite before it returns the handover. Ordinary creation
does not collect email, though the private schema permits another role to have
one later without changing sign-in again.

At *Set your password*, a live code reveals “Your username is …” and the person
must type that username plus the same new password twice. The form uses
`autocomplete="username"` and `autocomplete="new-password"` so a conforming
password manager can associate the submitted pair. Whether Chrome actually
shows a save prompt remains browser-controlled.

**One-time handovers are purpose-bearing.** Ten Crockford-base32 characters
shown as `XXXXX-XXXXX` (50 bits; I, L, O and U are absent) create either an
**activation** or a **password-reset** handover. A link is live only while it
is unconsumed, unsuperseded, and unexpired; a historical or expired row never
changes what People says. Replacing a handover supersedes one of the same
purpose. Only its hash is stored, in a column no client role can read. Preview
consumes nothing. A mistyped username does not consume the code; unknown,
expired, spent, superseded and inactive-account codes remain indistinguishable.
Failed callers are bounded over a rolling window without storing raw IP
addresses.

**People edits are one complete, guarded transition.** An authorized admin
submits permitted personal facts and the entire intended live assignment set
together. Unchanged assignments retain their identity and start date; a
promotion or transfer ends the prior row and adds the replacement without
deactivating access. The transaction validates authority over both the current
and intended sets, rejects stale views and invalid/empty ordinary edits, and
rolls back every fact if it refuses. A live activation handover is replaced
only after the final placement exists; a live reset handover is preserved and
an established account is never sent an unsolicited reset. A username
correction also preserves an outstanding handover because it is bound to the
Auth user ID rather than identifier text.

**Sessions are long-lived** — access tokens last an hour and refresh silently,
with no inactivity timeout. An Auth-alias rename preserves the current user ID,
password hash and refresh sessions. Ending a session early is an administrative
act: deactivate the account.

**Deactivation bites immediately, and an assignment change needs no new
session.** A deactivated account cannot read even its own profile row; the
client uses that confirmed invalid-session response as its signal to end the
open human session. Assignments are read from the database on every request, so
an edit applies at the next request without changing or reissuing a token. A
definitive invalid session ends the human shell; a forbidden response stays on
the requesting screen and an unavailable backend preserves the session for a
retry.

Password recovery has one current path: every role asks an authorized
Franchise Admin or Super Admin for a new one-time link. One Super Admin can
help another. An associated email is an alternate sign-in and is not by itself
a self-recovery entitlement. Automated email recovery is explicitly deferred
to [Super Admin Email Recovery](../openspec/todos/super-admin-email-recovery.md).

Changing a password one still knows and self-service username changes remain
deferred to [Self-Service Account Settings](../openspec/todos/self-service-account-settings.md).

**Who may provision whom** is re-derived inside the privileged function from
the caller's own session, never from the request:

| | Super Admin | Franchise Admin |
|---|---|---|
| Create an account | any role; account email required only for Super Admin | Biller / Employee at one or more managed outlets |
| Edit facts / assignment set | another account; any permitted role and outlet | Biller / Employee only, and only when the complete current and intended sets are within managed outlets |
| Mark as left | any account but their own; preserves history | own-outlet Billers and Employees |
| Issue setup / reset handover | any account but their own; purpose follows successful-sign-in history | own-outlet Billers and Employees |
| Deactivate / reactivate | any account but their own | own-outlet Billers and Employees |
| See / correct username | any managed account, plus own read-only username | own-outlet Billers and Employees, plus own read-only username |
| See / correct Super Admin account email | own read-only; another Super Admin editable | never |

**Username and private account email are deliberately not columns on
`profiles`.** Usernames are parsed from `auth.users` only at the privileged
account boundary. Account emails live in a separate no-client-access table.
The reason is specific: `profiles_select` lets outlet roles see coworkers they
need operationally, while a future Biller session is a shared counter tablet.
Neither a colleague's credential nor the owner's inbox should become ambient
on that device.

Secure Email Change and double confirmation remain enabled in Auth; completing
a hand-crafted client email-change request would require confirmation through
the existing non-deliverable alias, so it cannot rewrite that alias. Admin
username correction through the service-role boundary is the only supported
rename path.

Nobody manages their own account from People. A Super Admin can see their own
account email but changing it belongs to the later account-settings surface;
another Super Admin or an operator is the fallback if that value is wrong.

**People facts and placement share the privileged edit boundary.** Name, phone,
title, account email where permitted, and the complete intended assignment set
are changed atomically after the caller's authority is re-derived. Username,
active state, handover issuance, and departure remain distinct guarded actions.
**Mark as left** is the only departure transition: after confirmation it ends
all live assignments and deactivates sign-in atomically, without deleting
history. Ordinary editing never deactivates an account or treats an empty set
as departure.

**Deleting a person with recorded history is refused by the database itself.**
Historical foreign keys are NO ACTION; only assignment, invite and private
account-email plumbing cascades. Remove access by deactivating and remove
placement by ending assignments.

### Counter tablet — setup, and the two-device shift

Two layers, because a shared device has a different threat model than a personal one — and **no password is ever typed on the tablet**, at setup or afterwards. That is the whole point of both of them.

1. **Setup (once per tablet).** A Franchise Admin or Super Admin generates a **setup code** on their *own* phone, from the Tablets surface, and types it into the tablet at the counter. The privileged function re-derives the issuing admin's authority from the stored record, enforces one active tablet per outlet, creates the machine Auth identity and the `counter_devices` row, and hands back the credential that establishes the device session. The code is stored only as a hash, is shown once, is single-use, and expires in fifteen minutes — exactly the shape `account_invites` already has, because it does the same job for a person.

   The earlier design had an admin sign in on the tablet and destroyed that session afterwards. It was rejected: it types a personal password on the exact hardware this exists to keep passwords away from, and "we delete it immediately after" is a promise rather than a boundary.

2. **Opening a shift (per person, per evening).** The tablet takes a **username and nothing else** and displays a **four-digit confirmation code**. The named person, already signed in on their own phone, sees a card stating the outlet, the tablet and the time; they type those four digits and the shift opens. The tablet, watching its own request, enters billing without anybody touching it again.

   **A plain Approve button was rejected, and this is the substantive decision.** A request approved by one tap is approved by habit: anybody who can reach the tablet submits requests until the person taps through one without reading it. Requiring the code makes approval impossible unless the person can physically see the tablet, which is the property actually wanted — the premise is that they are standing at the counter. Same reasoning as number matching at GitHub and Microsoft.

   **This is one factor, not two**, and it is written that way rather than called two-factor. The factor it uses is stronger than the one it replaces, because an observer behind the counter can no longer collect a password by watching.

**A tablet is not a person.** Its Auth user *is* its `counter_devices` row; it has no profile and no assignment, and the session path asks the tablet question before the profile one so a machine can never resolve as a person with some rows missing. Everything it reaches — the outlet, the menu, bills, the expense it may record — comes from `app_counter_shift_outlet()`, so **no shift means no reach at all**.

**There is no fallback approver.** Only the named person may confirm their own shift: not the outlet's manager holding the correct code, not the owner. The cost is recorded in [Limitations](LIMITATIONS.md) rather than softened, along with the read-it-out-loud valve that goes with it.

**Enumeration safety is the database's.** An unknown username produces the same code, the same waiting state and the same timeout as a real one that is never confirmed, so the tablet cannot be used to discover who works here. The confirmation code is readable by nobody at all: `code_hash` is withheld by column grant from every client role, **including the person the request names**, who is expected to read the digits off the screen.

Why not full logins on the tablet: a shared device holding personal credentials is *worse* security, not better — sessions get left open, passwords get typed on a greasy counter screen dozens of times a day, and every biller learns every other biller's password within a week.

The honest trade-off: **the tablet's session is the credential, so a lost tablet is a real incident.** Mitigations are built in rather than retrofitted — `counter_devices.removed_at` is checked by every policy so removal is immediate and permanent, the tablet is scoped to one outlet and to the counter's own surfaces, and `last_seen_at` makes a missing tablet visible. Losing the tablet exposes one outlet's counter; it never exposes another outlet, admin functions, or the owner's cross-outlet view. And because it holds no password, a lost tablet compromises nobody's account.

**A Biller assignment includes an Employee's attendance.** Holding `biller` at an outlet is enough to check in there, without a second assignment and without widening what a manager or the owner may do — `attendance_submit_attempt` accepts either role, and `supabase/tests/25_the_biller_turns_up_too.sql` asserts it.

## Attendance and location

Employees check in from their own phones. The browser's Geolocation API supplies coordinates; the app computes the distance to the outlet's stored position.

**Policy: the fence is evidence, and a manager is the witness.** Every check-in is recorded and counts as nothing until an approval lands, in the fence or not — a phone inside the radius attests to where a phone was, which is not the same as somebody having worked. A reading beyond the radius is still shown to the person before they write, and recording it anyway is their decision to make.

**Approving is a capability, held by a Super Admin anywhere and by a Franchise Admin at outlets they hold a live assignment at.** Resolved from the approving session by membership, never from anything the request states; an Employee cannot approve their own day or anyone else's, and the database refuses it rather than the surface merely not offering it. An approval requires an arrival on the row: a day nobody claimed is not a day anybody can settle.

The same authority governs **deny and correct**. A Franchise Admin may decide
only the current attempt at an outlet they manage and may later correct a
settled day only while its outcome attempt is in their scope. The Super Admin
may do so across outlets. The database stamps the actor; requests cannot nominate
or forge a manager. Denials and all corrections require a non-blank reason.
Denial stores no manager GPS, while approval and correction-to-present store the
manager evidence their flows read. Retry-only and absent corrections are
locationless.

That same correction boundary permits **changing the effective check-in time
on a settled day, including a historical one**. The original attempt time,
source and GPS/manual evidence never change. The database appends the previous
time, replacement time, actor, decision time and mandatory reason; refuses a
future time or one outside the row's explicit outlet business date; and makes
the replacement the time used for lateness and every attendance view. The
employee sees this history but cannot write it. Waiting attempts must first be
approved or denied and do not offer the action.

An employee may submit a later attempt only for their own person/date and a live
outlet where they currently hold an Employee assignment. That attempt is allowed
after outside/unverifiable current evidence or an open denial; an in-fence
pending attempt, settled present/manual/leave/half-day, or globally prevented
day is refused at the command boundary. A multi-outlet employee may therefore
recover from checking in to the wrong outlet without gaining permission to make
two attendance days.

**One rule governs every approver, and it is about the approval rather than the role.** The approving device's position is read at that moment and the database computes its distance from the outlet. **Inside the fence, on the row's own business day, no reason is asked for.** Being outside it, supplying no position at all, and settling a business day that has already closed are one case and each require a reason that cannot be blank. Nothing is refused on distance alone, and every surface that shows an approval shows whether the approver was there — so approving from elsewhere is visible rather than prevented. The failure mode a refusal produces is a manager telephoning instead of recording anything, which is the workaround you cannot see.

There is no Super Admin fallback and no session-scoped "acting as" anything. The owner is simply an approver whose reach spans outlets, which is what their assignment already means everywhere else.

**Reading one person's days spans every outlet the reader may see, and the database decides which those are** (`attendance-one-day-per-person`, #29). The by-staff read names no outlet at all: a Franchise Admin holding one assignment reads that outlet, one holding two reads exactly those two, and the Super Admin reads all of them — resolved by policy from live assignments, never from anything the request states. A hand-crafted request naming a third outlet returns nothing, which is asserted in `supabase/tests/18_attendance_elsewhere.sql` rather than assumed. This reverses #22's decision to pin an explicit outlet on that read: that was right while the intended meaning was one outlet, and the intended meaning is now exactly the set the policy already computes.

**One bit crosses the outlet boundary, and it is the only one.** Because a person holds one attendance row per business date wherever it was worked, a Franchise Admin whose staff member went to the other shop sees no row at all — and, left alone, would derive *absent* for a day that person was paid for. `attendance_elsewhere(outlets, date)` answers which people **on their own outlets' staff lists** — a live Employee or Biller assignment there, the same list the roll-call is drawn from — are accounted for somewhere outside their scope. Person ids and nothing else: not which outlet, not the time, not the status, not the evidence, not the approver, not whether it was approved. The surface renders it as *working at another outlet* with no outlet named, and the underlying row stays refused. See [Security And Privacy](SECURITY_AND_PRIVACY.md).

Retry history preserves the same boundary. A manager who denied the earlier
Kalyani attempt may continue to read that local attempt and their own decision,
but a newer Kanchrapara attempt does not disclose its outlet, time, coordinates,
status or manager to them. The employee sees their complete history and the
Super Admin sees all of it. Waiting counts follow only the single current
attempt, so retry transfers attention to its outlet without leaving a stale
badge at the former one.

**A person is asked which outlet in exactly one situation**: they hold more than one assignment and their device can supply no position at all. Nothing is recorded until they answer, the resulting row carries no coordinates, and it waits for that outlet's manager on the same terms as any other unlocated check-in — which means a reasoned approval. Wherever a reading exists the fence is still the only chooser, and nobody is asked.

**Manager-entered attendance is the escape hatch.** An attendance kiosk on the counter tablet was considered and rejected by the owner (2026-07-28) — one shared device, usually busy billing, is the wrong place for everyone's check-in queue. Instead, when a phone is dead, out of data, or cannot get a fix, a Franchise Admin records the arrival themselves: past times only, on the outlet's current business day, and the row carries `manual` as its source with the enterer's identity stamped server-side, so it always reads *entered by* that admin. **Recording it settles it** — the admin has already attested to the arrival by typing it in, and asking them to then approve their own entry would be a second signature on the same sentence. The Super Admin can do the same at any outlet; an Employee or Biller session is refused by policy. Manual events carry no coordinates and are never judged by the fence — the fence judges a phone's claim to be standing somewhere, and an admin's entry is an attestation, not a claim. This is what makes hard-blocking survivable in daily use: there is always a way to record a shift that does not depend on one person's phone behaving.

**Deciding attendance requires the enrolled-device condition that reading it already required.** `attendance_decide_set` — the one command behind Approve and Deny, whether it settles one row or a selected set — checks `app_device_ok()` alongside the caller's live assignment. The single-row commands it replaced checked neither the device nor anything else about the session beyond the account being active, so a counter tablet whose enrolment had been removed could not read the attendance day it was looking at and could still settle rows on it through a hand-crafted request. It passes for every ordinary person session and fails only for a removed tablet, so no real flow changed. `supabase/tests/21_attendance_batch_decisions.sql` proves it against a session that is otherwise a fully authorised manager.

Every attendance row stores the captured coordinates, the GPS accuracy, the computed distance, and the source. Storing the inputs beside the verdict is what makes a disputed check-in reviewable — "the app said no" is not an acceptable answer to an employee about their pay.

**What location does and does not prove** is in [Limitations](LIMITATIONS.md), and it matters: browser geolocation is spoofable. This raises the bar; it is not evidence.

## Implementation notes

- **No authority is carried in the access token.** `multi-outlet-people` dropped both claim helpers and emptied the custom access-token hook to a no-op; the hook function itself went once the project stopped registering it (2026-07-30), so no code path remains by which a token could be handed authority. Policies resolve scope from `public.assignments` through stable `security definer` helpers — `app_is_owner()`, `app_outlets_for(role)`, `app_has_role_at(role, outlet)` — whose definer rights are what keep a policy on `assignments` from recursing into itself (see the RLS recursion trap in [Architecture](ARCHITECTURE.md)). `app_outlets_for` is set-returning on purpose: `outlet_id in (select public.app_outlets_for('franchise_admin'))` is non-correlated, so Postgres hoists it to one lookup per query rather than the per-row profile sub-query the old claims existed to avoid.
- **Held roles and reachable roles are two questions, and the code keeps them apart** (`owner-reaches-every-outlet`). `heldRoles(session)` answers what a person's live assignments confer, and it is what the account menu states — an owner who manages no outlet must never be told they do. `reachableRoles(session)` is held roles plus the outlet-level surfaces for the owner role, and it decides only which shells and navigation entries exist. It is not a role hierarchy: one specific reach for one specific role, and a manager assignment at Kalyani still confers nothing at Kanchrapara. Because reaching confers nothing, no policy changed for it and no migration was needed; the isolation suite gained the cases instead, so an owner-branch edited away fails a test rather than a screen.
- Outstanding invitations belong to the account, not to one outlet. They have their own policy and isolation cases, are written only by privileged functions, and are readable only by admins who may manage the whole account.
- Issuing and redeeming a handover are each a **single database function**, so "supersede then insert" and "check then consume" happen in one transaction. The complete People edit is likewise a service-only transaction: it validates, changes the assignment set, and conditionally replaces only a live activation handover in one commit. Doing either sequence across several Edge-Function round trips would leave a race, and the race is the attack.
- Everything needing immediate effect — an assignment change, deactivating an account, revoking a device — is a lookup inside the policy. Nothing waits for a token.
- **Self-assignment and the last owner** are the two rules a row policy cannot state, so they live in triggers on `assignments`: `assignments_self_grant_guard` refuses a self-granted `super_admin` from anybody and any self-grant from a non-owner; `assignments_guard` refuses ending the last live `super_admin` row, and freezes an assignment's identity so moving somebody is ending one and granting another.
- Edge Functions verify the caller's JWT for identity, then re-derive authority from that person's live assignments. Being an Edge Function is not authorisation.
- Every outlet-scoped table gets read and write policies in the migration that creates it, plus a case in the isolation test suite. See [Testing](TESTING.md).
