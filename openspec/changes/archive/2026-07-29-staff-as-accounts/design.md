# Design: staff-as-accounts

## Context

Staff identity currently lives in two tables. `public.profiles` is the account:
name, phone, role, outlet, `is_active`, keyed to `auth.users`. `public.employees`
is the roster: outlet, staff code, name again, phone again, salary, address,
`role_title`, `employment_status`, `joined_on`, and an optional
`profile_id` link. Attendance hangs off the roster
(`attendance.employee_id → employees.id`), and two UI surfaces exist to manage
the halves plus the link between them (Staff and Access/People).

On 2026-07-28 the owner removed both assumptions the split rested on: no
payroll data in this app, and every staff member gets an account. What remains
of the roster is a duplicate name/phone pair that can drift, a linking step
that reconnects what the split separated, and a class of states ("account with
no roster row", "roster row with no account") that exist only because the
split does.

Production staff data is at baseline (the one real check-in was test data,
since deleted), so the migration is at its cheapest. #9 (device enrolment,
shift attribution) should be designed against the merged model.

Constraints inherited from the owner's decisions (see proposal — not
relitigated here): one record per person; `is_active` and `left_on` as two
independent columns; no payroll fields anywhere; nothing with history is
deletable, enforced by the database; manual attendance entry replaces the
rejected kiosk; no hard email dependency beyond what exists today; nothing may
assume account-per-outlet.

## Goals / Non-Goals

**Goals:**

- One record per person: staff facts (`staff_code`, `role_title`, `joined_on`,
  `left_on`) live on `profiles`; the `employees` table, its triggers, its
  policies, its isolation cases, and both link UIs are removed.
- Every pre-merge attendance row survives, attributed to the same human.
- Deletion of an account with recorded history is refused by the database
  itself, including when the delete arrives as a cascade from `auth.users`.
- Manual attendance entry by FA (own outlet) and SA (any outlet), past
  timestamps allowed, with entry source and enterer stamped on the row and
  visibly distinct wherever attendance is read.
- One People surface: creating a person creates the account and staff-list
  membership in one step. Absorbs the `Select`-primitive adoption for the
  surfaces it touches.
- The demo dataset restates staff as accounts; the four-role walkthrough
  still walks; the trading day still reconciles.

**Non-Goals:**

- No payroll or salary anything (dropped, not moved).
- No kiosk. No multi-role grants (door open — nothing here assumes
  account-per-outlet). No email-less accounts (door open — placeholder
  addresses are a migration artifact, not a feature). No biller-role changes.

## Decisions

### D1 — Staff facts move onto `profiles`; the roster table dies

`profiles` gains four nullable columns:

- `staff_code text` — per-outlet display code, `unique (outlet_id, staff_code)`,
  non-blank when present. Null for accounts that never get one (Super Admin,
  billers).
- `role_title text` — free-text job label ("Griller", "Counter"). **Kept**, not
  dropped: it is the human answer to "what do they do here", distinct from the
  app-capability `role`, and it is already used on the roster row and its form.
- `joined_on date` — carried from the roster.
- `left_on date` — null means current staff. Replaces the `employment_status`
  enum, which is dropped with the table. `inactive`/`terminated` collapse into
  "departed" (`left_on` set); the "suspended but employed" middle state is
  expressed by `is_active = false` with `left_on` null.

`salary_paise` and `address` are dropped, not moved. No code path reads them
today; only seeds and fixtures supply them.

Rejected: a `people` view over two tables (keeps the drift), a rename of
`employees` to `people` keyed to `auth.users` (still two rows per person),
and keeping `employment_status` alongside `left_on` (one fact, two columns).

### D2 — `left_on` and `is_active` stay independent; coupling is convention

Owner decision, recorded here with its enforcement shape: **no database
constraint couples them.** The four combinations all mean something:

| `is_active` | `left_on` | Meaning |
|---|---|---|
| true | null | Normal current staff |
| false | null | Access cut (panic button) but still works here — still on today's attendance surface |
| false | set | Departed, access ended — the normal end state |
| true | set | Departed but can still sign in and read their own history — allowed, unusual |

The People surface's "mark departed" flow offers deactivation in the same
confirm (pre-checked), so the normal path lands in row three without a second
trip. The database does not enforce it: a constraint would forbid row two or
row four, and row two is exactly the state the owner's panic lever needs.
Sessions are governed by `is_active` alone (`app_account_active()` is
unchanged); `left_on` governs list membership only.

### D3 — Attendance re-attaches to the account: `person_id`

`attendance.employee_id` becomes `attendance.person_id uuid not null
references public.profiles (id)` — **no cascade**, mirroring the outlets
precedent ("seventeen foreign keys… not one of them cascades"). The column is
renamed, not just repointed, because after the merge the people on it can be
Franchise Admins as well as Employees, and every test keyed on it must be
rewritten for the id-space change anyway — the rename is free at the only
moment it will ever be.

Migration rewrites values via the link: `employees.profile_id` where linked,
the auto-provisioned account's id where not (D6). The unique constraint
becomes `(person_id, business_date)`.

RLS simplifies: the employee self-branch collapses from a roster subquery to
`person_id = auth.uid()`; the FA/biller branches compare the person's
`outlet_id` to the session claim. `app_employee_outlet()` is dropped and
replaced by `app_person_outlet(uuid)`, still `security definer` — the biller
insert branch must resolve a person's outlet, and the counter tablet may not
be able to read that profile (billers read only their own outlet's profiles,
which is sufficient today, but the helper keeps the policy honest rather than
depending on the select policy's current width).

**Who counts as staff**: outlet people are profiles with role
`franchise_admin` or `employee`. Billers are shared counter devices, not
people — no staff code, never listed on People-as-staff or attendance
surfaces. Super Admin is outlet-less. FAs are people who work at the outlet:
they get staff codes, they can appear on the attendance day.

### D4 — Staff-code machinery repoints to `profiles`

The #18 contract survives the roster's death — codes are how two same-named
people are told apart on attendance surfaces, and that need did not go away:

- `issue_staff_code()` trigger on `profiles` insert: when the row is a person
  role (`franchise_admin`/`employee`) with an outlet and no code supplied,
  issue `<outlet prefix>-<4-char Crockford suffix>` exactly as today.
- Code guard on update: only a Super Admin changes a code; blanking (or
  nulling) an issued code is refused for anyone. Database-enforced as before.
- `outlet_prefix_guard()` predicate rewritten: the prefix freezes once any
  profile at the outlet carries a staff code (previously: once any roster row
  exists).
- The migration backfills: linked people take their roster row's
  `employee_code`; unlinked roster rows carry their code onto the
  auto-provisioned account; pre-existing FA accounts without codes get one
  issued.

No `default ''` sentinel is needed on `profiles.staff_code`: the column is
nullable (a Super Admin's is null forever), so the generated Insert type is
already optional.

Rejected: letting codes die with the roster (attendance day, staff list and
adapter joins all display them; the disambiguation job remains) and issuing
codes to billers (a device is not a person one reads a code aloud for).

### D5 — Deletion refusal is the foreign keys themselves

*(Revised during apply: the design originally called for a catalog-walk
`before delete` trigger. Implementation showed the trigger restates what the
keys already enforce.)*

Every foreign key onto `profiles(id)` is plain NO ACTION except the
`account_invites` cascade (an invite is plumbing, not history), so an account
with any recorded row already refuses deletion in Postgres — including a
delete aimed at `auth.users`, whose cascade onto the profile is stopped by
the same keys. That is the outlets precedent exactly: the absence of cascades
IS the boundary, with no flag to maintain and no list of tables to keep in
step. New history tables are covered the day their FK is created.

Two things keep the property from regressing silently: the migration itself
aborts deployment if a cascading FK onto `profiles(id)` ever appears (a
catalog self-check in `20260729000002`), and
`09_outlet_and_staff_setup.sql` asserts the cascade allowlist and proves the
refusal with hand-crafted deletes from both the table's own side and the
auth side. The `provision` cleanup path — delete the just-created auth user
when a later step fails — keeps working, because a just-created account has
no history.

### D6 — The migration auto-provisions accounts for unlinked roster rows

Every `employees` row without a `profile_id` gets an account created in the
migration itself: an `auth.users` row (mirroring `supabase/seed.sql`'s
insert shape) with a **placeholder address** `<uuid>@placeholder.invalid` and
no usable password, plus a `profiles` row (role `employee`, the roster row's
outlet, name, phone, code, `role_title`, `joined_on`, and `left_on` when the
roster said terminated). No invite code is issued by the migration — issuing
is an admin's deliberate act, done after fixing the address with the existing
`set-email` machinery.

`.invalid` is the RFC 2606 reserved TLD: mail to it cannot route, which keeps
the owner's "never assume the auth system won't send mail" door open — the
system may mail anyone, it just never has a reason to mail a placeholder,
because no code exists for that account until an admin has replaced the
address. The People surface badges placeholder addresses as needing fixing.

Name drift resolves in the account's favour for linked pairs: the profile's
`full_name`/`phone` win, the roster copies die. The account is the identity
the person actually signs in as; the roster copy is the one nobody could see
drift.

### D7 — Staff fields get a client write path; identity fields stay privileged

Today `profiles` has zero client writes — everything routes through the
`admin-accounts` edge function. Splitting by field:

- **Identity and access** (`role`, `outlet_id`, `is_active`, email): stay
  edge-function-only, authority re-derived from the caller's token. Unchanged.
- **Staff facts** (`full_name`, `role_title`, `joined_on`, `left_on`,
  `staff_code`): become writable by the admin's own session under RLS —
  column-level `grant update`, plus a `profiles_update_staff` policy
  (SA any row; FA rows at their own outlet). The staff-code guard (D4) sits
  under the policy, so "a policy that permits the row permits every column"
  stays answered the way `identity-and-access:837` argues — by the database.
- **Insert and delete**: stay revoked. Creation goes through `provision`
  (extended to accept `role_title`/`joined_on`); deletion through nothing.

Rejected: routing staff edits through the edge function (contradicts the
recorded argument for RLS-governed roster edits in
`docs/ROLES_AND_PERMISSIONS.md`, widens the privileged surface, and makes
every field edit a service-role write for no gain).

### D8 — Manual attendance entry: a new source, a dedicated enterer stamp

The design question was: reuse the `override_by/reason/at` triplet, or a
dedicated enterer set alongside a new source? **Dedicated.** An override is a
recorded decision about a person's own blocked claim; a manual entry is an
admin supplying the event itself. Conflating them would make "who approved
this block" and "who typed this in" the same column and lose one of the two
answers the moment both happen to one row.

Shape:

- `check_in_source` enum gains `'manual'` (a separate migration file from its
  first use — `ALTER TYPE … ADD VALUE` cannot be used in the transaction that
  adds it).
- Four columns on `attendance`: `check_in_entered_by uuid references
  public.profiles (id)`, `check_in_entered_by_name text`, and the check-out
  pair. Per-event, because check-in and check-out can be entered by different
  admins on different days.
- The guard stamps `entered_by = auth.uid()` and snapshots the name whenever
  the event's source is `manual`, exactly as it already does for
  `override_by_name` — never client-supplied, frozen thereafter.
- Constraints: a manual event carries an enterer and **no coordinates** (the
  admin was not there; fabricated evidence is worse than none); a non-manual
  event carries no enterer. The geofence trigger does not judge manual events
  — there is no evidence to judge, and the enterer stamp is the
  accountability instead.
- Timestamps: manual events may be in the past but not the future, and land
  on the outlet's current business day (`validate_business_date` continues to
  apply; back-filling prior *days* is out of scope until someone needs it).
- RLS: the existing FA insert/update branch already permits writing rows for
  their own outlet; SA writes any outlet. The Employee branch stays pinned to
  `source = 'phone'` and the biller branch to `'counter_tablet'`, so neither
  can fabricate a manual entry. The guard additionally refuses `'manual'`
  events from non-admin sessions, so the rule is not an accident of policy
  branch shapes.

Wherever attendance is read (manager day, employee history, evidence
components), a manual event renders with an "entered by <name>" marker in
place of GPS evidence — visibly distinct from a self check-in.

### D9 — One People surface

The Staff roster surface (`employee-roster.tsx`, gates `owner-employees`,
`admin-employees`, route `employees`) is deleted. The accounts surface
becomes **People** for both SA and FA (gate nav renames from "Access" to
"People" for FA; route stays `people`):

- **Create**: one form — name, email, phone, role, outlet, role title, joined
  on — one `provision` call, one issued-code panel. No staff-list radios, no
  link step, no two-write partial-failure state.
- **List**: current staff by default (`left_on` null), a toggle reveals
  departed people; per-row: staff code, role title, role, invite/address
  state (placeholder addresses badged), active state.
- **Actions**: edit staff fields (RLS path, D7); mark departed (confirm
  offers deactivation, pre-checked, D2); return (clear `left_on`);
  deactivate/reactivate, new code, change email (edge-function paths,
  unchanged).
- The five inline `<select>`s on the two old surfaces become the shared
  `Select` primitive — the touched-surface trigger in
  `openspec/todos/select-primitive-not-adopted-everywhere.md` names this
  change.
- The hidden `counter-attendance-kiosk` gate entry is removed: the kiosk was
  rejected and manual entry is its replacement.

The attendance day surface re-sources its people list from profiles (person
roles at the outlet, `left_on` null — deactivated people remain listed, per
the gate) and gains the manual-entry action (record check-in/out at a chosen
past time). The employee surfaces lose their `no-roster` states — a signed-in
employee *is* the person record; `useOwnAttendance` reads by own id.

### D10 — Demo dataset: accounts are the only people list

`fixtures/employees.ts` dies. `fixtures/accounts.ts` becomes the person list,
carrying staff codes, role titles, `joined_on`/`left_on`; attendance seeds
re-key from roster ids to account ids. The mock employees adapter is deleted
with its interface; the People/attendance mocks read the one account list
(`DemoData.accounts` already models "accounts and the roster are one set of
people").

The deliberately-unfinished states are restated, not lost:

- **Demo Helper** becomes the *migrated* unfinished state: an account with a
  placeholder `@placeholder.invalid` address and no invite issued — "cannot
  sign in until an admin fixes the address and issues a code".
- **Demo New Starter** stays the invite-outstanding state.
- **Demo Former Staff** gains `left_on` (departed: off the staff list, history
  intact).
- One person is deactivated with `left_on` null — the panic-button state,
  still on the attendance day.
- **Demo Griller** becomes an ordinary active account (its old job — the
  linking demo — no longer exists); the walkthrough's linking step is
  replaced by create-a-person-in-one-step plus a manual attendance entry.

People carry no money, so the trading day's reconciliation is untouched; the
store's construction-time consistency checks continue to prove it.

## Risks / Trade-offs

- **[Enum + transaction]** `ALTER TYPE check_in_source ADD VALUE 'manual'`
  cannot be used in the same transaction that adds it → the enum change ships
  as its own migration file, ahead of the file that references it.
- **[Direct `auth.users` inserts in a migration]** GoTrue's table shape is not
  a public contract → the insert mirrors `supabase/seed.sql` column-for-column
  (the repo already owns that risk there), and production is at baseline so
  the auto-provision path will run against zero rows in prod.
- **[Cascade from `auth.users`]** `profiles.id … on delete cascade` means an
  auth-level delete is the real deletion path → the refusal trigger is on
  `profiles` and fires inside the cascade, aborting the statement; pgTAP
  proves it from the `auth.users` side, not just the table's own.
- **[`test:e2e:auth` blast radius]** The Employee index (`staff-home`), the
  auth shells, and the People surface all change → the Docker-backed suites
  (`test:db`, `test:rls`, `test:e2e:auth`) are part of this change's
  verification, not optional extras.
- **[pgTAP completeness assertions]** `12_required_fields_not_blank.sql`
  names every not-blank constraint and asserts no others exist; dropping
  `employees_*` and adding `profiles_staff_code_not_blank` must edit that
  list or the suite fails by design.
- **[Historical `entered_by` vs future roles]** If #9 reshapes the biller
  into device enrolment, `'counter_tablet'` rows may become historical-only;
  nothing here assumes otherwise.
- **[Departed-but-active accounts]** D2's row four (signed-in alumni) is
  allowed by the database; the surface communicates it rather than the schema
  forbidding it. Accepted: the alternative forbids the panic-button state.

## Migration Plan

Forward-only, three files (local dev resets; prod is at baseline):

1. `…_manual_check_in_source.sql` — `alter type public.check_in_source add
   value 'manual';`
2. `…_staff_as_accounts.sql` — the merge, in order: add `profiles` columns +
   constraints; backfill linked people from their roster rows; auto-provision
   accounts for unlinked roster rows (auth.users + profiles, placeholder
   addresses); add `attendance.person_id`, rewrite from `employee_id` via the
   link map, swap constraints/indexes, drop `employee_id`; drop `employees`
   (policies, triggers, `employee_profile_same_outlet`,
   `app_employee_outlet`), drop `employment_status`; add `app_person_outlet`;
   rewrite the attendance policies; staff-code triggers on `profiles`;
   prefix-freeze predicate rewrite; the no-cascade self-check (D5);
   staff-field grants + update policy.
3. `…_manual_attendance_entry.sql` — the four `entered_by` columns,
   constraints, and the guard's manual duties (stamping, non-admin refusal,
   past-times-only on the current business day). The geofence needed no
   change: its denial branch names `phone`, and a null distance cannot
   exceed a radius — manual events fall through it untouched.

Then: `supabase/seed.sql` restated (staff as profiles); `npm run db:types`;
adapters/UI/fixtures/tests as tasked. Rollback = `supabase db reset` locally;
nothing to roll back in prod (zero staff rows).

## Open Questions

None blocking. Two doors deliberately left as-is for later changes:
role-grants attach to this merged record (`role-grants-one-login-many-hats`),
and #9 decides the biller/device story against this model.
