# Design: blank-is-not-a-value

> Read [`proposal.md`](proposal.md) first. Tasks reference these decisions as
> D1–D7.

## The shape of the defect

Three independent layers each declined to check, and the value went through all
three:

```
  Name field:  required           ← inert. noValidate is on the <form>
       │
       ▼
  onSubmit()                      ← no check. Straight to the adapter.
       │
       ▼
  toColumns() → { name: ''.trim() }
       │
       ▼
  outlets.name text not null      ← satisfied. '' is not null.
       │
       ▼
  a nameless row
```

Only the third layer is a boundary. The first two are conveniences, and the
convention this repo already follows is that the convenience should exist *and*
the boundary should hold. `employees_code_not_blank` says so in its own comment.
This change adds the boundary in four more places and the convenience in three.

## D1 — `noValidate` stays, and so does `required`

The obvious fix is to delete `noValidate` and let the browser enforce
`required`. Rejected, and it is worth writing down why, because it will look
like an oversight to the next reader.

`noValidate` is on all eight forms in this app, which is not an accident. Native
validation shows a browser-drawn bubble whose wording, position and typography
cannot be styled or replaced. This repo writes refusals in a specific voice —
*"A staff code is needed to put someone on the staff list — it is how their
records are identified"* — and native validation would replace that with
*"Please fill out this field."* on some browsers and something else on others.
On a counter tablet and a staff phone, which is where this app runs, the
rendering varies more than on a desktop.

`required` stays on the inputs, because it is not only a validation hint: it
sets `aria-required`, which assistive technology announces. Removing it to
reflect that it no longer validates would take away the half of it that works.

**So the rule is: `required` marks the field for the person and their screen
reader, the guard refuses the submit, and the database refuses the write.**

## D2 — Inline guards, not a validation layer

Three forms, seven fields between them. A schema validator (zod, or a hand-built
`validate(draft)` returning a field-keyed error map) would centralise this, and
was rejected for a reason specific to this codebase.

The existing guards produce sentences that name a consequence:

```
'A staff code is needed to put someone on the staff list — it is how their
 records are identified. Give one, or choose "Not on the staff list".'
```

A generic layer produces `name: 'required'`, and the copy either becomes
generic or has to be threaded back through a map, at which point it is inline
again with extra indirection. For seven fields, the abstraction costs more than
it saves and pulls the copy in the wrong direction.

**Follow `onProvision`'s existing shape**: check on submit, `setError` with a
specific sentence, return before writing.

## D3 — The submit button stays enabled; the refusal names the field

Two precedents exist in this repo and they disagree, so this is a real choice:

| Precedent | Behaviour | Fields |
|---|---|---|
| `ChangeEmailSheet` | `disabled={busy \|\| email.trim() === ''}` | one |
| Attendance override | `disabled={!reason.trim()}` | one |
| `onProvision` | submits, then names what is missing | many |

Both disabling precedents are single-field sheets, where a dead button is
self-explanatory — there is only one thing it could be waiting for. The outlet
form has four required fields among ten. A button that greys out without
saying which of the four is missing is a worse experience than one that submits
and tells you, especially on a phone where the offending field may be scrolled
off screen.

**Multi-field forms follow `onProvision`. Single-field sheets keep their
disabled buttons.** No existing behaviour changes.

The error goes to the existing `error` state, which already renders in a
`role="alert"` region on all three surfaces. No new machinery, and it is
announced.

## D4 — Check constraints, in the shape the schema already uses twice

```sql
check (length(btrim(name)) > 0)
```

Identical to `employees_code_not_blank` and
`attendance_override_reason_not_blank`. Not a domain, not a trigger — a domain
would be the tidier abstraction and would mean five columns changing type in a
migration that currently only adds constraints, which is a much larger blast
radius for no behavioural gain.

Five columns, all of them things a human types and a human later reads to
identify something:

| Table | Column | Why it must not be blank |
|---|---|---|
| `outlets` | `name` | how every surface names the outlet |
| `outlets` | `code` | how a person refers to it in a sentence; also unique |
| `outlets` | `location_label` | shown beside the name on every outlet card |
| `employees` | `full_name` | the roster row is a person |
| `profiles` | `full_name` | the account is a person |

Deliberately excluded: everything nullable. `trimmed()` in the outlets adapter
already maps a blank optional field to `null`, which is the correct
representation of "not known" and is unchanged by this.

## D5 — The placeholder rule is narrow, and the narrowness is the point

A blanket "every placeholder gets `e.g.`" would be wrong. The app has two kinds:

**Sample values** — an example of what to type. These get the prefix:

| File | Current | Becomes |
|---|---|---|
| `outlets-surface.tsx:468` | `Shawarmania Kalyani` | `e.g. Shawarmania Kalyani` |
| `outlets-surface.tsx:480` | `kalyani` | `e.g. kalyani` |
| `outlets-surface.tsx:494` | `Kalyani — Central Park` | `e.g. Kalyani — Central Park` |
| `outlet-attendance.tsx:342` | `Seen at the counter; phone signal poor` | `e.g. Seen at the counter…` |

**Field names** — the accessible name of an input that has no visible label.
These must NOT be prefixed:

`City`, `District`, `PIN code`, `Line 2`, `Street and landmark` in the address
block. Each of those inputs carries `aria-label` and no visible `<label>`; the
placeholder is doing the work of a label. `e.g. City` would be incoherent.

Two further placeholders are neither and stay as they are: `XXXXX-XXXXX` on the
activation screen is a **format mask**, and *"Search a landmark, street or
shop"* on the address search is an **instruction**.

`Staff code, e.g. KAL-05` in `accounts-surface.tsx` is already correct and is
deleted by #18 anyway. `Grill, counter, prep…` on the roster is a judgment
call — the trailing ellipsis already signals open-endedness, and the field is
optional, so it is left alone rather than churned.

**Why `e.g.` rather than styling.** Italics or reduced opacity would be a
design-system change affecting every input in the app, would need contrast
re-validation in both themes, and would still not distinguish a sample value
from a field name — which is the actual confusion. Two characters of copy
solve the reported problem; a token change does not.

## D6 — This change's migration is dated after #18's, and #18 renumbers

`generated-staff-codes` claims `20260727000005` and has not been implemented.
This change ships first, so its migration is `20260728000001`. If #18 later
arrives still numbered `20260727000005`, it applies out of order — the Supabase
CLI treats that as an error condition, and it would be found at deploy time.

**Renumber #18's task 1.1 to `20260728000002` as part of this change**, rather
than leaving a trap. Editing another change's tasks file is unusual and is done
here deliberately: the collision is caused by this change's sequencing, so it
belongs to this change to resolve.

## D7 — The migration can fail on production data, and must be run knowing that

This is the only genuine risk in an otherwise small change.

Production currently holds an outlet whose `name` and `code` are both blank.
A check constraint is validated against existing rows when it is added, so this
migration **will abort** against that database. Locally it will pass, because
seeds are clean — so local success is not evidence here.

Two ways forward, and the choice is the owner's:

1. **Give the row a name and a code first** (the app can already do this — the
   edit path works), then migrate. Simplest, and leaves the constraint honest.
2. **Add the constraint `not valid`**, then `validate constraint` after the row
   is fixed. Correct for a table too large to lock, which `outlets` is not.

**Option 1 is recommended** and is written as a user-only gate step. Option 2
buys nothing here except a constraint that is temporarily lying.

Whichever is chosen, `employees.full_name` and `profiles.full_name` need the
same check against production before the migration runs, not only against
seeds.
