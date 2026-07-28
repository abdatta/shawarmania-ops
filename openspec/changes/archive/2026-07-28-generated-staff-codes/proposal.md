# Proposal: generated-staff-codes

> **Model**: Opus · **Wave**: B · **Depends on**: #15 · **Gate**: **an admin adds a person to the staff list without being asked to invent anything, the roster shows a readable code the app chose, and a Franchise Admin's attempt to change one is refused by the database rather than by the form.**

## Why

The staff-code field asks a question the business cannot answer. Shawarmania has
no existing staff IDs — no payroll numbers, no ID cards, nothing to copy in — so
every time the field appears, an admin is asked to invent an identifier on the
spot, on a phone, while onboarding somebody.

The app already knows the only convention it will ever follow. Its own
placeholder says `e.g. KAL-05`, the seed data reads `KAL-E1`, `KAL-E2`, and the
roster is outlet-scoped everywhere it is displayed. **A field whose correct
answer the app can compute is not a question; it is a chore with a failure
mode** — the code is unique per outlet, so an admin who reasonably types `1`
twice meets a constraint violation for a value that never mattered.

It never mattered because nothing keys on it. `attendance.employee_id`
references the roster row's UUID; there is no foreign key on `employee_code`
and no query looks a person up by it. Its entire job is to disambiguate two
people with the same name in three lists. A generated code does that job
better, because it is generated consistently.

What the business does want kept is the escape hatch: if a real staff-numbering
scheme arrives later, the owner should be able to set a code by hand rather
than being locked into what the app picked.

## Scope

**The field disappears from both create paths.** The Staff *Add person* form
and the Access provisioning form's *add them to the staff list* branch both
stop asking. Adding somebody to the roster becomes name-and-done.

**The database generates the code, not the form.** A `before insert` trigger on
`public.employees` fills a blank code with the outlet's three-character prefix
and a four-character random suffix — `KAL-7KQ2`, `KAN-3F8T`. It fills only when
none was supplied, so an explicit code still wins and every existing caller
keeps working. The suffix is drawn from the Crockford base32 alphabet already
used for one-time codes ([`invite-code.ts`](../../../supabase/functions/_shared/invite-code.ts)),
which drops `I`, `L`, `O` and `U` — these codes get read aloud across a counter
and dictated over a phone, so confusable characters are a real cost.

**Random, not sequential**, so there is no number to read before writing one and
therefore no race between two admins adding staff at the same outlet at the same
moment. The trigger retries on the rare collision and the existing uniqueness
constraint is the backstop.

**The prefix becomes a real, unique outlet attribute.** Three characters cannot
be safely truncated from an outlet's name — a future `kalimpong` would collide
with `kalyani` on `KAL`. So `outlets` gains a `staff_code_prefix` column with
its own uniqueness constraint, defaulted from the outlet code when an outlet is
created and shown on the outlet form. It is fixed once staff codes exist at that
outlet, because changing it would orphan every code already issued from it.

**Only the Super Admin may change a code, enforced in Postgres.** The Staff
screen's edit form already has the field, disabled; it becomes editable for the
owner and stays disabled for a Franchise Admin. That form control is the
convenience — the boundary is a trigger, because today's `employees_update`
policy lets a Franchise Admin update every column on the row, `employee_code`
included, and a restriction that lives only in a form is decoration.

**The edit lives on Staff, not on Access.** A staff code belongs to a roster
row, and roster rows exist without accounts — a griller who never touches the
app still has a code and appears only on Staff. Putting the control on Access
would leave exactly the people least likely to have a login unable to be
corrected.

**The demo generates identically.** The mock adapter follows the same rule, so
a demo does not teach a different product from the one that ships.

## Capabilities

### Modified Capabilities

- `identity-and-access`: the staff code is generated rather than supplied;
  provisioning no longer asks for one; a new requirement covers generation,
  per-outlet uniqueness, and owner-only mutation — all enforced by the database.

## Non-goals

**Renumbering anything that exists.** Every current row already carries a code
and `employee_code` is already `not null`, so no existing staff code changes.
The seeded `KAL-E1` and `KAL-E2` simply coexist with issued codes. The one
backfill this change does carry is on `outlets`: the two existing outlets get
`KAL` and `KAN` as their prefixes.

**Making the code mean anything.** It is a disambiguator in three lists, not a
key, and this change does not give it a second job. Nothing starts joining on
it, and it does not become an identifier the business is asked to rely on.

**A Franchise Admin editing codes.** Deliberately owner-only for now. If
managers turn out to need it, that is a later change with a reason behind it.

**A staff-numbering scheme.** The owner can set a code by hand; the app does
not learn to import, validate or enforce an external numbering convention.

**The Access screen gaining a code control.** Named here because it was the
first instinct and is the wrong home — see Scope.

## Watch out for

**A prefix must never change once codes exist beneath it.** `KAL-7KQ2` means
nothing if Kalyani later becomes `KLY`. The prefix is editable only while the
outlet has no roster rows, and the database is what decides that.

**Randomness needs a bounded retry, not an unbounded one.** Four Crockford
characters give about a million codes per outlet, so a collision against fifty
staff is vanishingly rare — but "rare" in a trigger still needs a defined
number of attempts and a clear error if they are all exhausted, rather than a
loop that can spin.

**The demo must not be genuinely random.** A mock that returns a different code
on every render makes snapshot tests flaky and a demo unrepeatable. It needs a
deterministic generator that still produces the right *shape*.

**Seeds and service-role writes must keep working.** The owner-only guard needs
the `if auth.uid() is not null` escape hatch that `attendance_guard()` already
uses in the same migration, or seeding breaks.

**The edit path can still blank a code.** `employees_code_not_blank` stays, and
the owner's edit form must surface its refusal as a sentence rather than a
constraint name.

**This change now ships third**, after `outlet-deletion` (#20) and
`blank-is-not-a-value` (#19). Two consequences. Its migration and pgTAP file are
renumbered to `20260728000003` and `13_` — see [#19's design D6](../blank-is-not-a-value/design.md),
which fixes all three numbers in one table. And the outlet form already guards
its required fields by then, so task 7.1's Staff code prefix field —
*"pre-filled, editable, never a blank box"* — inherits that guard rather than
having to build one.

**Tests keyed on the code will break.** `data-testid={\`unlinked-${employee.employeeCode}\`}`
and its siblings in `employee-roster.tsx` and `outlet-attendance.tsx` assume the
test knows the code in advance, which stops being true once the app picks it.
Key them on the row id.

**The helper text on the edit form is now false.** It says a staff code *"does
not change"*. It does, for one role.

## User-only gate steps

- Add a person to the staff list on a real outlet without being asked for a
  code, and confirm the roster row reads sensibly on a phone.
- Sign in as a Franchise Admin and confirm the code field is not editable.

## Docs to update before archiving

- `docs/DATA_MODEL.md` — the `employees` row: how `employee_code` is now filled.
- `docs/SCREENS.md` — the Staff description and the Access provisioning
  paragraph, both of which currently say a staff code is supplied.
- `docs/OPERATIONS.md` — the outlet-onboarding runbook step that tells an admin
  to supply a staff code.
- `docs/ROLES_AND_PERMISSIONS.md` — the capability matrix gains an owner-only
  row for changing a staff code.
