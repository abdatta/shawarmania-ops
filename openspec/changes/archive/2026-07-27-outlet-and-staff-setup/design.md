# Design: outlet-and-staff-setup

## Context

Attendance (#5) is implemented, deployed, and unreachable. Production holds one
profile, zero outlets and zero employees, and no screen can change either of
those numbers:

- **Nothing creates an outlet.** `outlets_insert` and `outlets_update` policies
  have existed since `data-model-and-tenancy`, and the Super Admin has an
  Outlets surface — but that surface only *captures a position onto* an outlet
  that already exists. With zero outlets the account form has nothing to assign
  anyone to, so no Franchise Admin, Biller or Employee can be provisioned
  either. The whole product is behind a row nobody can insert.
- **Nothing writes `employees.profile_id`.** That column is how an app account
  and a roster row become the same person: `getOwnEmployee()` finds a roster row
  by `profile_id = auth.uid()`, and the attendance policies scope an Employee's
  reads and writes through the same join. `createEmployee` does not send it,
  `updateEmployee` cannot patch it, and no Edge Function touches it. A real
  employee signs in and is told they are not on the staff list, with no screen
  anywhere that can put them on it.

Both gaps survived a full verification pass — unit, component, pgTAP, REST and
Playwright — because **every fixture and seed describes a business that is
already configured**. `employeeFixtures` hard-codes `profile_id`; `seed.sql`
inserts outlets before anything else; the REST suite signs in as a seeded
employee whose link was written by SQL. Nothing ever asked how a configured
world comes to exist, so nothing noticed that the app cannot produce one.

The relevant schema is already correct and needs almost nothing:

| Fact | Where it already lives |
|---|---|
| Only the Super Admin may write an outlet | `outlets_insert` / `outlets_update` |
| A linked login must share the roster row's outlet | `employee_profile_same_outlet` trigger |
| One profile links to at most one roster row | `employees.profile_id … unique` |
| A Franchise Admin may write only their outlet's roster | `employees_insert` / `employees_update` |
| Profiles have no client write path at all | `revoke insert, update, delete on public.profiles` |

That last row is the one that shapes this change: because the link cannot be
stored on the profile, **the link is a column on `employees`, written by an
ordinary RLS-governed client write** — not by a privileged function.

## Goals / Non-Goals

**Goals:**

- A Super Admin creates, edits, deactivates and reactivates an outlet from the
  app, starting with none.
- An app account and a roster row can be linked and unlinked, from **both** the
  Staff screen and the Access screen, by whoever has authority over that outlet.
- Every screen that shows a person answers *"can this person actually check
  in?"* without anyone opening a database.
- The chain in the gate runs end to end on production with no SQL.

**Non-Goals:**

- Tablet enrolment (#9), menu (#10), inventory (#11), cash float (#12).
- Bulk import, CSV, invitation emails, outlet deletion.
- Salary. `employees.salary_paise` stays untouched and unread, as in #5.
- Replacing #14 `outlet-onboarding`, which still has to prove the *whole* chain
  works for a franchisee with nobody helping.

## Decisions

### D1 — Outlet create/edit lives on the existing Outlets surface, not a new one

`owner-outlets` is already `live` and already lists outlets as cards. Creating
and editing become an "Add outlet" action in the page header and an "Edit" on
each card, both using the same `FormSheet` the rest of the app uses.

*Rejected:* a separate `owner-outlet-detail` route. It would double the
navigation for a business that will own single-digit numbers of outlets, and
the proposal's warning against "outlet CRUD for its own sake" applies directly.

### D2 — The empty state is the instruction, and it is the important screen

With zero outlets the current surface renders `No outlets yet.` and stops. That
is the exact screen a new owner sees on their first sign-in, and it must be the
one that tells them what to do. It gets the primary action inside it.

The same applies one screen over: the account form's outlet select, with no
outlets to offer, SHALL say that an outlet must exist first rather than
presenting an empty dropdown. Every check on both screens must hold with zero
rows — no `outlets[0]`, no assuming a selection exists.

### D3 — Linking is a client write under RLS, never a privileged function

`employees.profile_id` is written by PostgREST from the admin's own session.
The `employees_update` policy already scopes it to the caller's outlet, and the
`employee_profile_same_outlet` trigger already refuses a cross-outlet link.

*Rejected:* extending the `admin-accounts` Edge Function to write the link
while it provisions. It would make provision-and-link atomic, but it would move
an ordinary outlet-scoped write behind the service-role key, where RLS no
longer governs it — trading a real security boundary for a convenience. The
service-role key exists because RLS cannot create an `auth.users` row; a roster
column is not that.

**Consequence, accepted deliberately:** provisioning-with-a-roster-row is two
writes and can half-fail. If the account is created and the roster write is
refused, the admin sees the one-time code *and* an error saying the person has
an account but is not on the roster yet. That state is not a dead end — it is
exactly the state the Staff screen exists to repair, from the other direction.

### D4 — Provisioning an Employee offers the roster, and never assumes it

The account form, when the role is Employee, presents an explicit three-way
choice rather than a silent side effect:

1. **Add them to the staff roster** (needs a staff code) — the default.
2. **Link to someone already on the roster** — a select of unlinked roster rows
   at that outlet, shown only when there are any.
3. **Not on the roster** — for a login that is not a payroll employee.

*Rejected:* auto-creating the roster row whenever the role is Employee. The
schema separates `profiles` from `employees` on purpose, and an automatic write
would quietly assert that every Employee account is a payroll employee. It
would also invent a staff code, and a staff code identifies payroll records for
years.

For roles other than Employee the field is absent — not disabled — because a
Franchise Admin *may* be on the roster but rarely is, and the Staff screen is
where that unusual case is handled.

### D5 — Any active account at the outlet may be linked, not only Employees

The Staff screen's account picker offers every active account belonging to that
outlet that is not already linked. A working manager is on the roster too, and
the schema restricts the link by outlet, not by role. Restricting it in the UI
would be inventing a rule the database does not have.

### D6 — The Super Admin gets the Staff surface, with an outlet picker

`EmployeeRoster` currently reads its outlet from the session and renders
`This account is not assigned to an outlet.` for the Super Admin — who is
outlet-less by constraint (`profiles_outlet_matches_role`). The gate has the
owner linking an employee to a roster row, and *"why can't this person check
in?"* is asked on a phone call to the owner. So the surface resolves its outlet
from the session for a Franchise Admin and from a picker for the Super Admin;
one component, one extra piece of state, one new registry entry
(`owner-employees`).

### D7 — The link is a column on the read model, resolved by an embedded select

`EmployeeSummary` gains `linkedAccount: { id, fullName, isActive } | null`,
read through a PostgREST embed on the existing roster query rather than by
joining two lists in the screen. RLS filters the embed exactly as it filters a
direct read: a Franchise Admin sees their outlet's profiles, and an Employee
calling `getOwnEmployee()` sees their own — which is the only one their row
could point at.

*Rejected:* deriving the name in the screen by cross-referencing
`accounts.listAccounts()`. It would work for the two admin screens and break for
`getOwnEmployee`, which an Employee calls and which must not require permission
to list accounts.

### D8 — One error base class instead of a third parallel one

`AccountActionError` and `AttendanceActionError` are the same six lines twice,
and `createEmployee` already throws `AttendanceActionError` for a roster code
collision because employees never got their own. Adding a third for outlets
would repeat the mistake.

A `DataActionError(code, message)` base is introduced; both existing classes
extend it, unchanged in name and behaviour, so every existing `instanceof`
check and test still passes. New outlet and link refusals throw it directly,
and the surfaces catch the base — which makes their error handling shorter, not
longer.

### D9 — Deactivating an outlet stops new check-ins and never stops a check-out

Deactivation is the only outlet field with consequences beyond its own row, and
the schema has never exercised it. It means *this shop is not trading*, and:

- The outlet disappears from assignment lists and from the operating views.
- **A check-in at an inactive outlet is refused**, with a message naming the
  reason. A closed shop that silently records attendance is worse than one that
  says no.
- **A check-out is never refused** — someone mid-shift when the outlet is
  deactivated must be able to close their day. This mirrors design D3 of
  attendance, where a check-out is never blocked for any reason.
- **Nothing cascades.** Accounts, roster rows and recorded attendance are
  untouched; reactivating is one tap. The confirmation dialog says what
  deactivation does *not* do, because an owner who expects it to revoke logins
  would be dangerously wrong.

This is the one behaviour needing a migration — a check in the attendance write
path. Everything else in this change is served by policies that already exist.

### D10 — Editing the cutover is safe, and that is a property of the schema

`business_day_cutover` is editable on the outlet form. Changing it cannot
reinterpret history, because business dates are stored as explicit `date`
columns and never derived from a timestamp at read time. The new cutover
applies to the next day resolved, and nothing already written moves. This is
the constraint from `AGENTS.md` paying for itself, and the form says so.

### D11 — The demo gains the two unconfigured states it never had

The blind spot that produced this change was fixtures describing a
finished world. The demo therefore ships:

- an account at Kalyani with **no roster row**, and
- a roster row with **no account**,

so the walkthrough shows both halves of *"this person cannot check in"* and the
linking that resolves them. The Playwright demo walk exercises the link rather
than reading a pre-linked fixture.

The mock accounts adapter also stops minting ids in the
`d2000000-0000-4000-a000-…` range, which currently collides with
`DEMO_STAFF_EMPLOYEE_ID`. Harmless while the two lists are never compared;
actively misleading the moment they are.

### D12 — The email address is served by the privileged function, and never stored on `profiles`

A mistyped address is unrecoverable today (see the proposal), and the fix needs
the address to be readable by the admins who may manage the account. The
obvious move — mirror `email` onto `public.profiles` — is the wrong one:

**`profiles_select` admits Billers.** The policy lets a Biller read every
profile in their own outlet, because shift attribution needs names. A Biller is
a *shared counter tablet* that whoever is standing at it can pick up. Mirroring
the column would put every colleague's personal email address on that tablet,
permanently, as a side effect of a fix for a typo. Contact details of staff are
exactly the kind of thing that must not become ambient on a shared device.

So the address stays where it already is — `auth.users`, unreadable by every
client — and `admin-accounts` returns it, per caller, for the accounts that
caller may manage. Concretely:

- a Super Admin gets every address; a Franchise Admin gets their own outlet's
  Billers and Employees, which is the same set `mayManage` already governs;
- **a Biller or an Employee is refused outright** — not handed an empty map,
  which would be a boundary that merely happens to hold. There is no people
  surface on the counter shell either, but the UI is the convenience and the
  function is the boundary;
- the correction path (`set-email`) reuses the identical `mayManage` matrix, so
  reading an address and changing one can never disagree about who may.

*Rejected: `profiles.email` with the column grant revoked*, the trick already
used for `account_invites.code_hash`. It works, and it leaves a column on a
table read by four roles whose safety depends on nobody ever writing
`select *`. The address is auth data; leaving it in the auth table is the
version with no ongoing obligation.

*Rejected: moving the whole account list into the function.* Today the Super
Admin's query and the Franchise Admin's are literally the same query and the
database returns different rows — the clearest demonstration of tenancy in the
codebase. One extra call for the one field RLS cannot serve is cheaper than
losing that.

### D13 — Correcting an address does not invalidate the outstanding code

The code is bound to the profile, not to the address, so once the address is
corrected the code the admin already sent starts working. Reissuing would
invalidate the message they have already passed on and turn one mistake into
two. The surface says so, because an admin who has just fixed a typo will
otherwise reasonably assume they need to start again.

## Risks / Trade-offs

**Provision-and-link is not atomic** → the failure mode is a real account with
no roster row, which is both visible on two screens and repairable in one tap.
The alternative (D3) was worse.

**An outlet-picker on Staff gives the Super Admin write access to any outlet's
roster** → they already have it in the policy (`employees_insert` /
`employees_update` both admit `super_admin` unconditionally). This surfaces an
existing authority rather than granting a new one.

**Refusing check-ins at an inactive outlet can lock out a whole shop** → it is
one tap to reverse, the refusal names the cause, and it fails toward *not*
recording attendance for a shop that is closed. The opposite default silently
accumulates attendance nobody will ever reconcile.

**An admin can link an account to the wrong person** → the link is unlinkable,
the confirmation names the person and the consequence, and both screens show
the resulting state plainly. Nothing about the link is destructive.

**Scope creep toward an admin console** → held back by the gate: this change is
finished when an employee checks in, not when outlets have every field a form
could carry. Fields beyond those the gate needs stay out.

## Migration Plan

One forward-only migration, small:

1. Refuse a check-in whose outlet is `is_active = false`, in the attendance
   write path, leaving check-out and every existing behaviour untouched.
2. pgTAP coverage for the refusal, for the check-out exemption, and for the
   linking authority cases (cross-outlet link refused, second link to the same
   profile refused, Franchise Admin confined to their own outlet).

No data migration: nothing in production has rows to move. Rollback is a
further migration, per the forward-only rule.

## Open Questions

None blocking. Two recorded for later changes:

- **Should an outlet ever be deletable?** Not in this change — an outlet with
  history cannot be, and one without history is rare enough to leave
  deactivated. Revisit if a franchise is ever set up and abandoned.
- **Should unlinking be restricted once attendance exists against the link?**
  Currently no: history lives on the roster row and survives unlinking. If it
  turns out managers unlink to hide a record, this becomes a policy question.
