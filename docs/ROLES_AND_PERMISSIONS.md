# Roles And Permissions

> The policies exist and are enforced (`data-model-and-tenancy`), and all four roles now sign in against them (`auth-and-roles`). The counter tablet's own story — device enrolment and shift PINs — is still as designed; see the note under [Counter tablet](#counter-tablet--device-enrolment--shift-pin).

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
is derived rather than stored.

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

**The owner who runs a shop** is simply assigned as its Franchise Admin, and
writes there like any manager. That authority comes from the assignment rather
than from being the owner, which is exactly why it stops at that outlet.

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
| Manage Franchise Admins | ✓ | — | — | — |
| Manage Billers and Employees | ✓ | ✓ only when every live outlet they work at is one this admin manages | — | — |
| Assign a person to an outlet | ✓ any outlet, any role | ✓ own outlets, Biller/Employee only | — | — |
| Assign **themselves** to an outlet | ✓ outlet roles only — never the owner role | — | — | — |
| End an assignment | ✓ | ✓ own outlets | — | — |
| Edit staff facts (name, job title) | ✓ any outlet | ✓ own outlets | — | R own row |
| Enrol / revoke counter device | ✓ | ✓ own outlet | — | — |
| **Menu** |
| View menu | R all | ✓ own outlet | R own outlet | — |
| Add / edit / disable items and prices | ✓ | ✓ own outlet | — | — |
| **Billing** |
| Create a bill | — | — | ✓ own outlet | — |
| View bills | R all | R own outlet | R own shift | — |
| Void a bill | ✓ | ✓ own outlet | — | — |
| **Inventory** |
| View stock and low-stock warnings | R all | ✓ own outlet | — | — |
| Record movements | — | ✓ own outlet | — | — |
| **Expenses** |
| View | R all | ✓ own outlet | — | — |
| Record | — | ✓ own outlet | — | — |
| **Attendance** |
| Check in / out | — | ✓ self | — | ✓ self |
| Enter attendance for someone (past time, today) | ✓ any outlet | ✓ own outlet | — | — |
| View attendance | R all | ✓ own outlet | — | R self |
| Override a failed geofence check | ✓ | ✓ own outlet | — | — |
| **Daily cash** |
| View | R all | ✓ own outlet | — | — |
| Record withdrawal, close the day | — | ✓ own outlet | — | — |
| **Profit and loss** |
| View outlet P&L | R all | R own outlet | — | — |
| Compare outlets | ✓ | — | — | — |
| **Alerts** |
| Raise an alert | — | ✓ own outlet | — | — |
| View and respond | ✓ all | R own alerts | — | — |

**Deleting an outlet is the only delete anybody has.** Every other record in the system is voided, deactivated or corrected — the database grants `DELETE` to no client role on any other table. The exception is bounded by a precondition Postgres enforces rather than the screen: an outlet goes only while nothing anywhere references it, so one that ever traded cannot be deleted at all. It is for a shop created by mistake, and the app offers it only after the outlet is marked closed, so the reversible action always comes first.

Two deliberate asymmetries worth noting. **The Super Admin cannot create bills** — billing is a counter action tied to an enrolled device and a shift, and letting the owner ring up a sale from their phone would corrupt attribution and cash reconciliation. **The Biller only sees their own shift's bills**, not the outlet's whole history; reviewing the day is a manager's job, and it keeps a shared tablet from exposing the outlet's takings to whoever is standing at it.

## Authentication

### Personal smartphones — email + password

Super Admins, Franchise Admins and Employees sign in with their email address and a password they set themselves.

*(Owner-confirmed 2026-07-26, replacing an earlier phone+password design. Phone sign-in turned out to drag in an SMS-provider dependency even with no OTP flow — the auth service gates password sign-in behind the provider flag — while email carries no external dependency at all: addresses are pre-confirmed at provisioning and no mail is ever sent. Phone numbers remain on profiles as contact data only.)*

Accounts are **admin-provisioned**: an admin creates the person's record with the email pre-confirmed and selects one role at one or more outlets. The system creates every selected assignment first, then issues one one-time code for the whole account, which the admin passes on (in practice over WhatsApp, which the business already uses). The person redeems it at *Set your password*, and is signed in from there with all of those assignments already live. No SMS provider and no TRAI/DLT registration is involved anywhere, and no mail is ever sent — not even a confirmation.

**The one-time code, as built.** Ten Crockford-base32 characters shown as `XXXXX-XXXXX` (50 bits; the letters I, L, O and U are absent so nothing can be misread). Valid seven days, redeemable once, dead after five wrong attempts, and superseded the instant a replacement is issued — so exactly one code per account is ever live. It is stored only as a hash, in a column no client role can read at all, which is why an admin sees it once and never again. If an assignment is granted or ended before activation, the authority change and a replacement invite happen in one database transaction and the new link is shown immediately; the old link never silently dies. Once the person has activated, assignment changes create no new code. Every way redemption can fail produces one identical response: an unauthenticated endpoint must not become a way to find out which addresses have accounts.

**Sessions are long-lived** — access tokens last an hour and refresh silently, with no inactivity timeout. A delivery employee who opens the app fortnightly should not be re-authenticating, and there is no self-service reset to rescue them if they are. Ending a session early is an administrative act, not a timer: deactivate the account.

**Deactivation bites immediately, and an assignment change needs no new session.** A deactivated account cannot read even its own profile row, because every policy is gated on the active check — and the client uses exactly that as its signal, ending the open session within five minutes (sooner if the tab is returned to) rather than waiting an hour for the token. An assignment granted or ended is different in kind since `multi-outlet-people`: nothing about authority is carried in the token, so the database honours it at the next request and the open client picks it up on the same revalidation cycle. No token is reissued and nobody is signed out for having been moved. The only credential replacement is the visible activation-link replacement described above, and only while an unconsumed invite exists.

Password reset in v1 is admin-initiated: the admin issues a new one-time code. Self-service reset was considered and deliberately not shipped, and neither was changing a password you still know — both are recorded in [`openspec/todos/`](../openspec/todos/README.md). Google sign-in mapped to the same email address is a possible later convenience, not a commitment.

**Who may provision whom** is re-derived inside the privileged function from the caller's own session, never from the request:

| | Super Admin | Franchise Admin |
|---|---|---|
| Create an account | any role, one or more outlets | Biller / Employee, one or more managed outlets |
| Issue a new code | any account but their own | own-outlet Billers and Employees |
| Deactivate / reactivate | any account but their own | own-outlet Billers and Employees |
| See / correct the sign-in address | any account, plus their own | own-outlet Billers and Employees, plus their own |

**The sign-in address is deliberately not a column on `profiles`.** It lives in
`auth.users`, which no client can read, and reaches an admin surface only
through the privileged function — which refuses a Biller or an Employee
outright rather than returning an empty result. The reason is specific:
`profiles_select` lets a Biller read every profile in their own outlet, and a
Biller *is a shared counter tablet* that whoever is standing at it can pick up.
A column there would make every colleague's personal email address ambient on
that device, permanently, as a side effect of an admin convenience.

Correcting an address does **not** cancel an outstanding one-time code — the
code is bound to the account, not the address, so it starts working the moment
the address is right. This matters because a mistyped address is otherwise
undiagnosable: redemption and sign-in both refuse an unknown address with the
same uniform message they give a wrong password, so a typo presents as "the
code is broken" and nothing contradicts it.

Nobody manages their own account. Locking the only Super Admin out has no in-app recovery, and re-issuing your own code is meaningless while you are signed in.

**Editing a person's staff facts** is a different kind of write and is governed differently. Since `staff-as-accounts` (#21) the person *is* the account: there is no roster table and no link step, and a griller who never touches the app is simply an account on a placeholder address that cannot be signed in with. What is left of the staff facts since `multi-outlet-people` — the name and the job title — is an **ordinary column-scoped write under Row-Level Security**, made by the admin's own session rather than by the privileged function: the column grant plus `profiles_update_staff` allow the Super Admin anyone and a Franchise Admin the people at outlets they manage. Access (active state, the sign-in address) stays reachable only through the privileged function, and placement is an assignment with its own policy. Two rules are enforced by the database, not the form:

- `left_on` cannot precede `joined_on`; and
- **departure and deactivation are independent facts** — marking someone departed does not end their sessions, and deactivating them does not remove them from the staff record. The People surface offers both together at departure so neither is forgotten.

**Deleting a person with recorded history is refused by the database itself**: every foreign key onto `profiles` is NO ACTION (the sole exception is the invite cascade), so the account stays because the days were worked. Remove access by deactivating; remove list membership with a leaving date.

### Counter tablet — device enrolment + shift PIN

> **Not built yet.** Device enrolment and shift PINs arrive with `counter-devices-and-offline`. In the meantime a Biller signs in on the tablet with their own email and password, which is exactly the arrangement this section argues against — accepted briefly and on purpose, and recorded in [Limitations](LIMITATIONS.md). RLS scopes them to one outlet's billing surfaces either way.

Two layers, because a shared device has a different threat model than a personal one:

1. **Enrolment (once per tablet).** A Franchise Admin or Super Admin signs in on the tablet and enrols it as that outlet's counter device. The device receives a long-lived session whose RLS scope is exactly one outlet. This is the real credential.
2. **Shift unlock (per biller).** The biller picks their name and enters a short PIN. This opens a shift and determines bill attribution. **The PIN is not the security boundary** — it prevents casual misattribution and walk-up use, nothing more. A 4-digit PIN alone would be far too weak to protect outlet data, which is exactly why it does not.

Why not full logins on the tablet: a shared device holding personal credentials is *worse* security, not better — sessions get left open, passwords get typed on a greasy counter screen dozens of times a day, and every biller learns every other biller's password within a week.

The honest trade-off: **the tablet's session is the credential, so a lost tablet is a real incident.** Mitigations are built in from the start, not retrofitted — `counter_devices.revoked_at` is checked by policy so revocation is immediate, the device is scoped to one outlet and to billing surfaces only, and `last_seen_at` makes a missing device visible. Losing the tablet exposes one outlet's billing screen; it never exposes another outlet, admin functions, or the owner's cross-outlet view.

## Attendance and location

Employees check in from their own phones. The browser's Geolocation API supplies coordinates; the app computes the distance to the outlet's stored position.

**Policy: block outside the geofence, with a Franchise Admin override.** A check-in beyond the radius is refused and offers to request an override; the manager approves from their phone, and the approval is recorded on the attendance row with who approved it and why.

**Manager-entered attendance is the escape hatch.** An attendance kiosk on the counter tablet was considered and rejected by the owner (2026-07-28) — one shared device, usually busy billing, is the wrong place for everyone's check-in queue. Instead, when a phone is dead, out of data, or cannot get a fix, a Franchise Admin records the check-in or check-out themselves: past times only, on the outlet's current business day, and the row carries `manual` as its source with the enterer's identity stamped server-side, so it always reads *entered by* that admin. The Super Admin can do the same at any outlet; an Employee or Biller session is refused by policy. Manual events carry no coordinates and are never judged by the fence — the fence judges a phone's claim to be standing somewhere, and an admin's entry is an attestation, not a claim. This is what makes hard-blocking survivable in daily use: there is always a way to record a shift that does not depend on one person's phone behaving.

Every attendance row stores the captured coordinates, the GPS accuracy, the computed distance, and the source. Storing the inputs beside the verdict is what makes a disputed check-in reviewable — "the app said no" is not an acceptable answer to an employee about their pay.

**What location does and does not prove** is in [Limitations](LIMITATIONS.md), and it matters: browser geolocation is spoofable. This raises the bar; it is not evidence.

## Implementation notes

- **No authority is carried in the access token.** `multi-outlet-people` dropped both claim helpers and emptied the custom access-token hook to a no-op; the hook function itself went once the project stopped registering it (2026-07-30), so no code path remains by which a token could be handed authority. Policies resolve scope from `public.assignments` through stable `security definer` helpers — `app_is_owner()`, `app_outlets_for(role)`, `app_has_role_at(role, outlet)` — whose definer rights are what keep a policy on `assignments` from recursing into itself (see the RLS recursion trap in [Architecture](ARCHITECTURE.md)). `app_outlets_for` is set-returning on purpose: `outlet_id in (select public.app_outlets_for('franchise_admin'))` is non-correlated, so Postgres hoists it to one lookup per query rather than the per-row profile sub-query the old claims existed to avoid.
- Outstanding invitations belong to the account, not to one outlet. They have their own policy and isolation cases, are written only by privileged functions, and are readable only by admins who may manage the whole account.
- Issuing and redeeming a code are each a **single database function**, so "supersede then insert" and "check then consume" happen in one transaction. Assignment grant/end use service-role-only functions that preserve the supersession trigger and conditionally issue the visible replacement in that same transaction. Doing either sequence across several round trips from an Edge Function would leave a race, and the race is the attack.
- Everything needing immediate effect — an assignment change, deactivating an account, revoking a device — is a lookup inside the policy. Nothing waits for a token.
- **Self-assignment and the last owner** are the two rules a row policy cannot state, so they live in triggers on `assignments`: `assignments_self_grant_guard` refuses a self-granted `super_admin` from anybody and any self-grant from a non-owner; `assignments_guard` refuses ending the last live `super_admin` row, and freezes an assignment's identity so moving somebody is ending one and granting another.
- Edge Functions verify the caller's JWT for identity, then re-derive authority from that person's live assignments. Being an Edge Function is not authorisation.
- Every outlet-scoped table gets read and write policies in the migration that creates it, plus a case in the isolation test suite. See [Testing](TESTING.md).
