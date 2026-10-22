# Proposal: Staff Roles Include Other Roles

> **Model**: Opus · **Kind**: structural, no roadmap row: nobody can do anything
> new when it ships · **Unblocks**: #80 `waiters-take-orders-on-their-phones`,
> whose Waiter is the first new staff role · **Gate**: which staff role includes
> which is written down once, as plain rows (a Biller includes an Employee), and
> every check of what a staff member may do asks those rows instead of naming
> roles; every answer they give an Employee, a Biller, a Manager and the owner is
> the answer today's checks give, proved by the existing attendance, expense,
> Team and counter suites; a role cannot include itself or, through others,
> include a role that includes it; a migration or app file that lists staff roles
> by name fails lint; and with the gate off every check runs exactly as it does
> today.

## Why

A Biller does everything an Employee does, plus the counter. The app behaves
that way, but it is not built that way. Biller is a separate label, and every
place that means *any staff member* lists both names: 19 live database objects
(attendance check-in, expenses, Team's role changes, menu reads) and about a
dozen places in the app (design, *What names a staff role today*).
`a-biller-is-staff` (2026-08-14) made Biller staff by going round those places
adding `'biller'` beside `'employee'`.

Adding the Waiter (#80) the same way would mean that trip again, and so would
every role after it. The owner asked for the smell to be fixed once, so a new
role is a line and not a search (owner, 2026-10-21).

## What changes

**Which staff role includes which is written down as plain statements.** One
row says one thing: *a Biller includes an Employee*. A role includes everything
the roles it includes include, followed down any number of rows. There are no
ranks and no numbers (owner, 2026-10-21):

| Role | Includes |
|---|---|
| Biller | Employee |

**Roles may branch.** A role may include several roles, and several roles may
include the same one. When the roles grow, a Cook and a Biller could both
include a Waiter without either including the other, and a Head cook could
include both. Today there is one row.

**Every check asks the rows.** Where a check named roles, it asks whether a role
the person holds there includes the one it needs:

- *Is this person staff here?* becomes *can they act as an Employee here?*
- *May this person read the menu from their phone?* becomes *can they act as a
  Biller here?*

**Nothing anybody sees changes.** An Employee, a Biller, a Manager and the owner
get exactly the answers they get today, everywhere. Only where the answer comes
from changes.

**Managers and the owner are not staff roles.** Their authority comes from their
own assignments and the owner role, as today. A Manager does not act as an
Employee: managers do not check in. The rows can take them later without a
redesign; this change does not.

**The rows stay sound.** The database refuses a row that makes a role include
itself, or include, through others, a role that already includes it, and a row
naming a manager or the owner.

**A new role is a row or two.** #80 adds Waiter with *Waiter includes Employee*
and *Biller includes Waiter*. Every check that asks for an Employee then admits a
Waiter, and every check that asks for a Biller does not.

**It stays fixed.** A migration or an app file that lists staff roles by name
outside these rows fails lint, so the next role cannot be added the old way by
accident.

## Change gate

- **`role-includes`** (*RI*)
  - **On:** Who counts as staff, and who may hold a counter, is answered by which
    roles include which, everywhere the database asks.
  - **Off:** Each check names Employee and Biller itself.

**Off is today, and nothing On saves outlives it.** On and Off give the same
answer to every role that exists, so the gate is a safety switch, not a feature:
if the new checks are wrong anywhere, Off puts back the checks that ran
yesterday. A row written under On is a row Off accepts, because the same people
may write the same rows (round trip `none:`, design D7).

**The app's own lists are not behind the gate.** Session reachability, Team's
role choices, the demo's role switcher and the shell order read one map in
`src/data-access/role-includes.ts`. Every answer they give is today's, proved by
a unit test over every combination of roles a person can hold. A refactor that
changes no answer has no behaviour to gate.

## Non-goals

- **Any new role.** Waiter arrives with #80.
- **Managers or the owner as staff roles.** Their authority model is unchanged.
- **The discount source called `'biller'`.** Five billing commands contain the
  word, as the source of a discount the biller typed, not as a role. They are
  not staff checks and are not touched.
- **Dropping the old functions.** They stay callable, so a Republish to any
  earlier build keeps working. They are dead once no build calls them, and are
  removed in an ordinary cleanup later (design D8).

## Capabilities

### Modified

- `identity-and-access`: *Biller is an Employee-capable assignment* becomes
  staff roles that include other roles, of which *Biller includes Employee* is
  the one row today.

## Impact

- **Database**: the `staff_roles` and `staff_role_includes` tables, the trigger
  that refuses a loop, and three helpers; `_v2` of the five attendance, expense
  and attribution functions the app calls, and of the helper the `profiles`
  policy reads; a gated permissive twin beside each of the ten policies that
  name staff roles; a `change_gates` row, off. No existing function, policy or
  trigger changes until the cleanup, which also rewrites the expense trigger,
  the Team helper and the counter-shift helper (design D4, D8).
- **App**: `src/data-access/role-includes.ts`, read by the session, Team, the
  demo and the shell; the gate's toggle points choose the `_v2` calls.
- **Counter and kitchen**: none visible. With the gate on the counter's menu
  reads are answered by the twins, with the same rows. The request budget does
  not move.
- **Lint**: `npm run lint:roles` refuses a staff list in the app and a by-name
  staff check in a migration after this one.

## Docs To Update Before Archive

- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md):
  staff roles include other roles, and *A Biller assignment includes an
  Employee's attendance* restated as a row.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): the two tables and the
  helpers.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md): a staff check asks the
  includes rows.
- [`AGENTS.md`](../../../AGENTS.md) → Tenancy: a staff role is never compared by
  name.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md): **Staff role**, **Includes**.
