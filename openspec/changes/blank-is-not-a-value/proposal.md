# Proposal: blank-is-not-a-value

> **Model**: Opus · **Wave**: B · **Depends on**: #15 · **Gate**: **a blank or whitespace-only value cannot be written into any required field from any form in the app, and the database refuses it too** — and no placeholder in the app can be mistaken for a value already filled in.

## Why

An outlet was created in production with no name.

The owner created an account for a new manager, who signed in, opened Outlets,
and created an outlet without typing a name into it. The row exists, it is
nameless, and nothing in the app can remove it.

Three things had to be true at once for that to happen, and all three are still
true everywhere else in the app:

**The placeholder read as a value.** The Name field's placeholder is
`Shawarmania Kalyani` — not a generic example, but the actual name of a real
outlet that already exists in this database. Somebody filling the form in good
faith saw a plausible, correct-looking name already in the box.

**`required` does nothing.** Every form in this app carries `noValidate`, which
switches off the browser's own constraint validation. All eight of them. The
`required` attribute on those inputs renders and has no effect on submission.

**Nothing else checked.** `onSubmit` in the outlet form goes straight to the
adapter. And `outlets.name`, `outlets.code` and `outlets.location_label` are
`not null` — which stops the column being *absent* and says nothing about it
being *empty*.

This is not a new discovery about this repo. `employees_code_not_blank` was
added for exactly this reason, and its migration comment already says it:

> an empty string satisfies a not-null constraint while satisfying nothing a
> person needs … The forms now refuse it too — this is the boundary, and that
> is the convenience.

That fix was applied to one column on one table. The same hole is open on the
outlet's name, its code, its location label, and on every person's full name —
on the Staff form and on the Access form both.

## Scope

**The database refuses blanks in the fields that must not be blank.** Check
constraints on `outlets.name`, `outlets.code`, `outlets.location_label`,
`employees.full_name` and `profiles.full_name`, in the same shape as
`employees_code_not_blank` and `attendance_override_reason_not_blank` — a
third instance of a pattern this schema already has twice.

**Three forms refuse before writing.** The outlet form, the Access provisioning
form and the Staff form each check their required fields for blankness on
submit, and name the field that is missing. `noValidate` stays and `required`
stays — see design.

**A placeholder that shows a sample value says `e.g.`** The rule is narrow and
deliberately not blanket: a placeholder showing an *example of the value*
(`Shawarmania Kalyani`) is prefixed, while a placeholder naming *the field
itself* (`City`, `Line 2`, `PIN code`) is not, because those are the accessible
name of an input with no visible label and prefixing them would be nonsense.
The convention already exists in this codebase — `Staff code, e.g. KAL-05` —
and the outlet form is the outlier.

**The one existing bad row is left alone.** This change stops the next one; it
does not clean up after the last one. Renaming or closing the nameless outlet
is a thing the owner can already do from the app today, and deleting it is
`outlet-deletion` (#20).

## Capabilities

### Modified Capabilities

- `outlet-tenancy`: an outlet's name, code and location label cannot be blank,
  refused by the database and by the form that writes them.
- `identity-and-access`: a person's full name cannot be blank, on the roster or
  on an account, refused the same way. Generalises the existing staff-code
  requirement rather than sitting beside it.
- `design-system`: a placeholder never reads as a filled-in value.

## Non-goals

**Removing `noValidate`.** It is on all eight forms deliberately: this app
writes its own refusals in its own words, and native validation bubbles are
neither styleable nor translatable nor consistent across the browsers a counter
tablet and a staff phone actually run. Turning it off would replace specific
sentences with the browser's generic ones. See design D1.

**A validation framework.** Three forms need a guard each. Introducing a schema
validator to serve them would be more machinery than the problem, and would
push this repo's specific, consequence-naming refusals toward generic
field-is-required copy — a regression in the thing this codebase is careful
about. See design D2.

**Optional fields.** Phone, address lines, city, district, PIN and role title
stay exactly as they are. A blank optional field is already stored as `null` by
`trimmed()` in the adapter, which is correct and unchanged.

**Deleting the nameless outlet.** Out of scope by sequencing, not by oversight —
`outlet-deletion` (#20) does that, and it has a doctrine to amend first.

**Every other form.** Sign-in and activation are not touched: their fields are
credentials checked by the server, where a blank fails on its own and a
client-side refusal would add nothing.

## Watch out for

**`code` is unique, and blanks collide.** Exactly one blank-coded outlet can
exist today, because `''` is a value and `outlets_code_key` is unique. If this
migration runs against a database that already has one, the check constraint
fails on the existing row and the migration aborts. **The nameless production
outlet must be given a name and a code before this ships**, or the migration
must be written to tolerate it. This is the one ordering risk in the change.

**The same trap on the roster and the profile tables.** Check every table this
migration touches for rows that already violate the new constraint, in
production and not only in seeds. Local seeds are clean by construction, so
local success proves nothing about production here.

**`generated-staff-codes` (#18) claims migration `20260727000005`.** This change
ships first, so its migration is dated later. #18's task 1.1 must be renumbered
or the two arrive out of order — a task below does it explicitly rather than
leaving it to be discovered.

**#18 adds a fourth required field to the outlet form.** Its task 7.1 promises a
Staff code prefix field that is *"pre-filled, editable, never a blank box"* —
a promise the form has no machinery to keep until this change lands. Landing
first is what makes that task cheap.

**Do not touch what #18 deletes.** The staff-code inputs in
`accounts-surface.tsx` and the add path of `employee-roster.tsx` are removed by
#18 tasks 6.1 and 5.1. Adding guards to them would be work thrown away, and a
merge conflict.

**A guard that fires on edit as well as create.** The outlet form is one
component for both, and the Staff form's edit path disables the code field.
Blanking a name while editing must be refused just as firmly as never typing
one, which is where the database earns its place.

## User-only gate steps

- 🧍 Give the nameless production outlet a name and a code before deploying the
  migration — or confirm the migration tolerates it.
- 🧍 On a phone, try to create an outlet with a space in the name field and
  confirm the refusal names the field.

## Docs to update before archiving

- `docs/DATA_MODEL.md` — the invariants list gains the blank rule; it currently
  states the not-null and soft-delete conventions and is silent on emptiness.
- `docs/DESIGN_SYSTEM.md` — the placeholder convention, and why it is narrow.
- `docs/SCREENS.md` — the Outlets paragraph, if it describes the form's fields
  as optional or required in a way this change changes.
