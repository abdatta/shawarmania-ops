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

## D6 — Migration and test numbering across #20, #19 and #18

Three unshipped changes each carry a migration, and migrations apply in
filename order. Out-of-order arrival is an error the Supabase CLI raises at
deploy time, which is the worst moment to find it — so the numbering is settled
here, once, for all three.

Build order is `#20 → #19 → #18` (D7), so the numbers follow it:

| Order | Change | Migration | pgTAP file |
|---|---|---|---|
| 1st | #20 `outlet-deletion` | `20260728000001_*` | `11_*` |
| 2nd | **#19 this change** | `20260728000002_required_fields_not_blank.sql` | `12_required_fields_not_blank.sql` |
| 3rd | #18 `generated-staff-codes` | `20260728000003_generated_staff_codes.sql` | `13_generated_staff_codes.sql` |

`10_activation.sql` is the last pgTAP file that exists, and
`20260727000005_activation_without_typing.sql` the last migration — both shipped
by #16. `supabase test db` globs the directory, so a pgTAP rename is a rename
and nothing else.

Two of those rows describe files this change does not write:

- **#18 has been renumbered from `20260727000005` and `11_`**, and its tasks
  file already carries the new numbers. Editing another change's artifacts is
  unusual and was done deliberately, because a stale number is found at deploy
  time. Note what that renumber also fixed: **`20260727000005` is not free — it
  is the migration #16 shipped**, so #18's original claim collided with a
  migration already on disk and would have failed on the first `db reset`,
  regardless of anything in this change. Sequencing merely surfaced it.
- **#20 is not yet proposed**, so it has claimed nothing. Its numbers are
  *reserved* above and recorded in its own proposal, so that `/opsx:propose
  outlet-deletion` finds them rather than picking `20260728000001` by counting
  and colliding with nothing — or, worse, picking `20260728000002` and colliding
  with this.

If the order changes again, this table is the thing to edit first.

## D7 — `outlet-deletion` (#20) ships first, and this change hard-depends on it

Production holds an outlet whose `name` and `code` are both blank. A CHECK
constraint is validated against every existing row when it is added, so this
migration **will abort** against that database. Locally it passes, because seeds
are clean — local success is not evidence here.

Three ways out were considered. **The owner has ruled out touching the row:** it
is to be removed through the app, not renamed, not edited, not corrected by
hand.

| | Approach | Verdict |
|---|---|---|
| 1 | Rename the row, then migrate | **Ruled out by the owner.** |
| 2 | Add the constraint `NOT VALID`, `VALIDATE CONSTRAINT` after #20 | Rejected — see below |
| 3 | Ship #20 first, delete the row, then migrate | **Chosen** |

**Why not option 2**, which is the tempting one, because it would let this
change land first and stop the recurrence sooner. A CHECK marked `NOT VALID`
skips existing rows at creation time but **still fires on every subsequent
UPDATE** of them. The nameless outlet would become entirely frozen — not
renameable, and no longer even markable-closed, because setting `is_active`
re-evaluates the constraint against a row whose name is still blank. Its only
remaining exit would be #20. If #20 then slipped, production would hold an
immovable row and no fallback. It also ships a constraint that is temporarily
untrue of its own table, plus a `VALIDATE CONSTRAINT` step in a later change
that has to be remembered.

**Option 3 is chosen.** It costs a longer window in which a blank outlet can
still be created — #20 is the larger change, and is not yet proposed — and buys
a constraint that is fully validated from the moment it exists, with no
two-phase migration, no follow-up step, and no state in which the bad row is
harder to remove than it is today.

**This makes #20 a hard dependency of #19, not a sequencing preference.** The
roadmap's dependency column is law, and it now reads `#15, #20`.

### Production state, verified 2026-07-28 (counts only, read-only)

The risk above was measured rather than assumed, against the linked production
project:

| Column | Blank rows | Total rows |
|---|---|---|
| `outlets.name` | **1** | 3 |
| `outlets.code` | **1** | 3 |
| `outlets.location_label` | **1** | 3 |
| `employees.full_name` | 0 | **0** |
| `profiles.full_name` | 0 | 2 |

All three outlet blanks are the **same row** — `7a81b17d-…`, created
2026-07-28T06:24Z, still `is_active`. It is the only obstacle to this
migration.

**The `employees` / `profiles` concern does not materialise.** Both were the
worrying case, because neither has a delete path and none is planned — a blank
there could not have been cleared by #20 or by this change. `employees` is
empty and both profiles carry a name, so there is nothing to correct and the
constraint can be added at full strength. Task 1.3 stays as a re-check rather
than an open question, because the measurement is a month older than the
migration will be.
