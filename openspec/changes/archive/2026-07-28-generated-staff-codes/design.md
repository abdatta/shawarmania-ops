# Design: generated-staff-codes

## Context

`employees.employee_code` has been a required free-text field since
`data-model-and-tenancy` (#2) created the table. Two surfaces ask for it: the
Staff *Add person* form, and the Access provisioning form when the roster
choice is *add them to the staff list*. Both refuse to submit without one.

Nobody at Shawarmania has a staff ID to enter. The value is therefore invented
at the keyboard every time, against a convention the app itself supplies as a
placeholder (`e.g. KAL-05`) and then declines to apply.

**What the column actually does, verified before designing anything:**

- Nothing keys on it. `attendance.employee_id` references `employees.id`, a
  UUID. There is no foreign key on `employee_code`, and no adapter looks a
  person up by it. Generating one, or later changing one, orphans no record.
- It is displayed to humans in exactly three places — the Staff row subtitle
  ([`employee-roster.tsx:233`](../../../src/features/employees/employee-roster.tsx)),
  the outlet attendance day row
  ([`outlet-attendance.tsx:262`](../../../src/features/attendance/outlet-attendance.tsx)),
  and the account-linking dropdown
  ([`accounts-surface.tsx:593`](../../../src/features/accounts/accounts-surface.tsx)).
  In all three its job is telling two people with the same name apart.
- It is unique per outlet (`employees_code_unique_per_outlet`) and non-blank
  (`employees_code_not_blank`, added by #15).

So the column is a display-only disambiguator carrying a uniqueness constraint
— which is precisely the shape of thing a system should issue rather than ask
for. The constraint is the reason it must be issued carefully: two admins
adding staff at one outlet simultaneously can collide on a value neither of
them chose.

The relevant existing policy is `employees_update`, which permits a Super Admin
any row and a Franchise Admin their own outlet's rows. **It is a row policy, so
it permits every column on a row it permits** — including `employee_code`.
Restricting who may change a code therefore cannot be done in the policy layer
without splitting it; it belongs in a trigger, exactly as `attendance_guard()`
already freezes attendance's identity columns and gates its override columns by
role in the same migration.

## Goals / Non-Goals

**Goals:**

- Remove the staff-code field from both create paths entirely.
- Have the database issue a short, readable, outlet-scoped code on insert.
- Make issuing correct under concurrent inserts at one outlet.
- Let the Super Admin, and only the Super Admin, change a code afterwards, with
  the refusal enforced in Postgres rather than in a form.
- Keep the demo adapter's behaviour identical to the real one.

**Non-Goals:**

- Renumbering or backfilling existing rows. Every row already has a code.
- Giving the code a second job. It stays a display disambiguator; nothing
  starts joining on it.
- Letting a Franchise Admin change codes.
- Importing or validating an external staff-numbering scheme.

## Decisions

### D1 — The code is issued by a `before insert` trigger, not by the client

The client sends no code at all; a trigger on `public.employees` fills it.

Issuing in TypeScript was rejected for three reasons, in order of weight. It
would have to read the outlet's existing codes to compute the next serial,
which is a second round trip *and* a read the caller may not be permitted to
make in full. It cannot be made race-free from outside the transaction that
inserts. And it would live in the adapter, which means the mock and the real
implementation would each own a copy of the rule and could drift — while the
seed, the tests, and any future import path would have no issuing at all and
would quietly go back to requiring a code.

Putting it in the trigger makes "a roster row always has a sensible code" a
property of the table rather than a habit of one caller. That matches how this
repo treats every other invariant on this table: cross-outlet links, blankness,
and attendance's identity columns are all trigger- or constraint-enforced.

**The trigger fills only when nothing was supplied.** A supplied code is stored
unchanged. This keeps the seed working as written, keeps `#14
outlet-onboarding` free to import codes if a franchise arrives with its own
scheme, and means this change adds a capability rather than removing one.

### D2 — Blank and absent are the same thing on insert, and different on update

`coalesce(btrim(new.employee_code), '') = ''` is the "not supplied" test on
insert — so `null`, `''` and `'   '` all mean *issue me one*. The form sends
nothing, so this is mostly about being forgiving to other callers.

On **update** the same blankness is refused, by leaving `employees_code_not_blank`
exactly as it is. The row already has a code; clearing the field is a mistake,
not a request. Silently re-issuing on update would turn "I cleared this by
accident" into "the app renamed this person", which is worse than an error
message.

This asymmetry is the one genuinely surprising thing in the change, which is
why it is written into the spec rather than left to the implementation.

### D3 — A random suffix, so there is no number to read before writing one

`KAL-7KQ2`: the outlet's prefix, a hyphen, and four characters drawn from the
Crockford base32 alphabet already defined in
[`invite-code.ts`](../../../supabase/functions/_shared/invite-code.ts) and
[`mock/accounts.ts`](../../../src/data-access/mock/accounts.ts) —
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, the digits and letters minus `I`, `L`, `O`
and `U`.

**The alphabet is not an aesthetic choice.** These codes are read aloud across
a counter and dictated down a phone during a shift; `0`/`O` and `1`/`I`/`L`
confusions are the failure this alphabet exists to prevent. Reusing the one the
repo already has beats inventing a second, and it is why the suffix is base32
rather than four digits — `32^4` is a million codes per outlet against `10^4`'s
ten thousand, for the same four characters.

**Random removes the race rather than defending against it.** Sequential
issuing has to read the current maximum before writing the next one, which is
what made a transaction-scoped advisory lock necessary in the first draft of
this design. Nothing needs to be read to pick a random code, so two admins
adding staff at one outlet simultaneously simply cannot contend.

**Collisions are handled by a bounded retry.** The trigger generates, checks
whether that code exists at that outlet, and tries again — up to ten times,
then raises. Against fifty staff in a million-code space a single collision is
already unlikely; ten in a row is not a case that occurs. The bound exists so
the trigger cannot spin, not because it is expected to be reached.
`employees_code_unique_per_outlet` remains the final backstop for the
astronomically small window where two transactions generate the same code
between one's check and the other's commit.

*Rejected — a per-outlet serial (`KAL-01`, `KAL-02`):* the readable option, and
the one this design originally chose. It needs the lock, and it quietly
promises something the column does not deliver — a sequence implies "the fifth
person hired here", which is false the moment a row is created out of order or
a code is set by hand.

*Rejected — a Postgres sequence per outlet:* DDL churn as outlets come and go,
and sequences do not roll back, so a failed insert burns a number and the codes
develop gaps that look like deleted staff.

*Rejected — four digits instead of base32:* ten thousand codes per outlet and a
`0`/`O` problem in the one place the code gets spoken.

### D4 — The prefix is a unique column on `outlets`, not a truncation computed at insert

`outlets` gains `staff_code_prefix text not null unique`, three characters from
the same Crockford alphabet.

Deriving it at insert time from `outlets.code` was the first design and is
wrong for a reason that only shows up later: `kalyani` and a future `kalimpong`
both truncate to `KAL`, and by the time that outlet is created there are
already `KAL-` codes belonging to somebody else. A derivation that can collide
retroactively is not a derivation, it is a latent conflict. Storing it makes
uniqueness a constraint the database enforces rather than a property nobody
checked.

**It is proposed, not demanded.** On the outlet form the field arrives filled —
first three alphanumeric characters of the outlet code, uppercased, with a
numeric suffix appended if that is taken — and the owner can correct it. This
keeps outlet creation a single act while leaving the one field that will appear
on every staff code at that outlet forever under human control.

**It is frozen once codes exist beneath it.** A `before update` trigger refuses
a prefix change when the outlet has any roster row, because `KAL-7KQ2` names a
prefix and re-pointing it would leave every issued code reading from something
that no longer exists. Before the first hire, changing it is free and allowed —
which is exactly when an owner notices they would rather have `KLY`.

*Rejected — leaving the prefix implicit and allowing cross-outlet collisions:*
defensible while uniqueness is per-outlet and every view is outlet-scoped, but
the owner asked for the prefix to identify the outlet, and a prefix two outlets
share does not.

*Rejected — a longer prefix to make collisions unlikely:* trades the readability
that is the entire justification for having a prefix.

### D5 — Owner-only mutation is a trigger, because the policy cannot express it

`employees_update` permits a row; a row policy permits every column on it. So a
Franchise Admin can change `employee_code` today, and a UI-only restriction
would be decoration — precisely the failure mode `AGENTS.md` names first.

A `before update` trigger raises when `new.employee_code is distinct from
old.employee_code` and `public.app_role() <> 'super_admin'`. This mirrors
`attendance_guard()` in `20260726000007`, including its `if auth.uid() is not
null` guard so that seeds and service-role writes — which have no role claim —
are unaffected.

*Rejected — splitting `employees_update` into per-column policies:* Postgres
policies do not gate columns; the equivalent is column privileges plus a second
policy, which would fracture a policy every other part of the roster depends on
in order to express one rule about one column.

*Rejected — routing code changes through an Edge Function:* the roster is
deliberately written by the admin's own session under RLS, never by the
service-role key (#15 D3). Adding a privileged path for a display string would
undo that for no gain.

### D6 — The edit control lives on Staff, and is inert rather than absent for a manager

The staff code belongs to a roster row, and roster rows exist without accounts
— a griller who never touches the app has a code and appears only on Staff.
Putting the control on Access would leave exactly those people uneditable, so
Staff's existing edit form is the home. The field is already there and already
`disabled` when editing; it becomes enabled for a Super Admin.

For a Franchise Admin it stays disabled **and says why**, rather than being
hidden. A missing field reads as a bug when a manager has been told the code
can be changed; a disabled one with a sentence beside it answers the question
on the screen where it gets asked. The trigger is the boundary either way.

The current helper text — *"A staff code identifies past records and does not
change"* — becomes false for one role and must be replaced, not merely
conditioned. It is also the sentence that made this design read the column's
real usage before touching it, and it was half right: the code does identify
past records, but only to a human reading a list.

### D7 — The mock issues codes by the same rule, in the same place

`createMockEmployeesAdapter` produces `PREFIX-XXXX` from the same alphabet, so
the demo teaches the shipped product rather than a form that still demands a
code.

**It must not be actually random.** A mock returning a different code on every
call makes snapshot tests flaky and a demo walkthrough unrepeatable — two
qualities this repo's demo mode explicitly sells. So the mock draws from a
small deterministic generator seeded per adapter instance: same sequence every
run, right shape, no `Math.random()`. The adapter already assigns ids from a
counter (`d2000000-…`), and this follows that precedent.

Its existing `code_required` refusal stops firing on absence and starts firing
only where the database's does — a blank supplied on update.

### D8 — Test IDs move from the code to the row id

`data-testid={\`unlinked-${employee.employeeCode}\`}` and its siblings assume
the test knows the code before the row exists. Once the app issues it, a test
that creates a person through the UI cannot know it. Keying on `employee.id`
is stable, already unique, and never displayed — so it cannot be broken by a
later change to how codes read.

## Risks / Trade-offs

**A trigger is invisible at the call site.** Someone reading
`createEmployee` will not see where the code comes from. → The adapter's
doc comment says so, and the migration is named for what it does. This is the
same trade already made for `employee_profile_same_outlet` and
`validate_business_date`.

**A random code carries no information.** `KAL-7KQ2` does not say who was hired
first, and cannot be guessed from a name. → It was never allowed to: the column
disambiguates two people with the same name in three lists, and a sequence
would have implied an ordering the column does not actually guarantee (D3).

**The bounded retry can, in principle, be exhausted.** → Ten attempts in a
million-code space against a roster of tens. If it ever raises, that is a
signal worth having rather than a silent fallback to a worse code.

**A prefix change is refused for a reason invisible on the outlet form.** An
owner editing an outlet a year later gets told they cannot change a field that
was freely editable when they created it. → The refusal carries the reason —
codes have been issued — rather than a constraint name, and the field is
visibly inert once a roster row exists.

**`outlets` gains a column that outlet creation must now fill.** This is the
one place where this change reaches outside the roster. → It is defaulted, so
the form gains a pre-filled field rather than a new question, and existing rows
are backfilled in the same migration.

**A Super Admin can set a code that duplicates one at another outlet.**
→ Already true and already fine: the constraint is per-outlet by design, and a
same-outlet duplicate is refused with a sentence rather than a constraint name.

## Migration Plan

One migration, in this order:

1. `outlets.staff_code_prefix text` added nullable, backfilled (`kalyani` →
   `KAL`, `kanchrapara` → `KAN`), then set `not null` with a `unique`
   constraint and a check that it is three characters from the alphabet. Adding
   nullable-then-backfilling-then-constraining is the only order that works on
   a table with rows.
2. `public.random_staff_suffix()` — four Crockford base32 characters.
3. `public.issue_employee_code()` — `before insert` trigger function: when no
   code was supplied, generate `prefix || '-' || suffix`, retry up to ten times
   against existing codes at that outlet, raise if exhausted.
4. `public.employee_code_guard()` — `before update` trigger function: refuse a
   changed `employee_code` unless `app_role() = 'super_admin'`, skipped when
   `auth.uid()` is null.
5. `public.outlet_prefix_guard()` — `before update` trigger function on
   `outlets`: refuse a changed `staff_code_prefix` when that outlet has any
   roster row.
6. Triggers attached; database types regenerated for the new `outlets` column.

No staff code changes. `employees_code_not_blank` and
`employees_code_unique_per_outlet` are untouched.

**Rollback** is dropping the three triggers and the `outlets` column. No staff
code issued in the meantime becomes invalid — they are just text — but the
forms would need their fields back, so the rollback unit is the change, not the
migration alone.

## Open Questions

None blocking. Two deliberately deferred:

- **Should a Franchise Admin ever change a code?** Owner-only for now because
  that is what was asked for and it is the reversible direction — widening
  authority later is a policy edit, narrowing it after managers have relied on
  it is a support conversation.
- **Should the roster display the code at all once nobody chooses it?** It still
  earns its place as a same-name disambiguator, and removing it from three
  surfaces is a separate question about those surfaces.
