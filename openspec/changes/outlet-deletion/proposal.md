# Proposal: outlet-deletion

> **Model**: Opus · **Wave**: B · **Depends on**: #15 · **Gate**: **an outlet with nothing attached to it is deleted from the app by the owner**, and one with anything attached refuses with a sentence naming what is still there — the refusal proved by a hand-crafted request, not by observing a disabled button.

> **This change blocks `blank-is-not-a-value` (#19), which lists it as a hard
> dependency.** #19 adds a CHECK constraint that validates against every
> existing row, and production holds an outlet whose name and code are blank.
> The owner has ruled out renaming or editing it, so it leaves through this
> change's delete action or not at all. #19 cannot begin until it is gone.
>
> **Reserved numbers**, settled in #19's design D6 so that three unshipped
> migrations do not collide: this change takes migration `20260728000001_*` and
> pgTAP file `11_*`. Do not renumber without editing that table.

## Why

An outlet created by mistake is permanent. There is no way to remove one from
the app, and there is no way to remove one from the database either — `DELETE`
is granted to no client role on any table.

This is not hypothetical. A newly provisioned manager created a nameless outlet
during their first session; it sits in production, appears in the owner's list,
and cannot be taken out. `blank-is-not-a-value` (#19) stops the next one being
created. It does nothing about the one that exists, or about an outlet created
correctly and then genuinely not needed.

**And #19 cannot ship until this one has.** Its constraint refuses to be added
while the nameless row is there, and the owner will not rename it to clear the
way. So the change that closes the hole is waiting on the change that cleans up
what fell through it — which makes this the more urgent of the two, not the
larger one that can wait.

**Marking an outlet closed is the right answer for an outlet that traded.** Its
staff, its attendance and its bills are history the business must keep, and
`is_active` already does exactly that job without destroying any of it. That
requirement exists and this change does not touch it.

**It is the wrong answer for an outlet that never existed.** A row created by a
mis-tap has no history to protect. Keeping it forever, greyed out in a list, is
not a data-integrity guarantee — it is a filing cabinet of typos, and every
person who ever opens the Outlets screen has to read past it and wonder whether
it means something.

## The doctrine this change has to amend, deliberately

This is the reason the change is not small, and the reason it is not folded into
#19.

**Nothing in this schema is client-deletable.** The grants migration says so in
its own header:

> DELETE appears nowhere: nothing in this schema is client-deletable. History
> is voided, soft-deleted, or corrected — never removed.

It is restated twice in `docs/DATA_MODEL.md`, and the isolation and write
contracts are built on top of it. `outlets` would become **the first
client-deletable table in the entire schema.**

That is a defensible amendment — the rule exists to protect *history*, and a row
with nothing attached to it has none — but it must be made explicitly, in
writing, with the boundary of the exception stated. It must not arrive as a
side effect of adding a button.

## Scope

**An outlet is deletable only while nothing references it.** Not while it is
merely inactive, and not on the strength of a flag somebody set — while the
database can prove no row anywhere points at it.

**The schema already proves it, for free.** Eighteen columns across the schema
reference `outlets(id)`, and **not one carries `on delete cascade`.** A
populated outlet therefore refuses its own deletion with a foreign-key
violation, with no bookkeeping to maintain and no list of tables to remember.
That property should be used rather than duplicated — the same instinct that
makes the isolation suite read the catalog instead of a hand-written list.

**This also satisfies "empty it, then delete it."** Because the check is the
live foreign-key state and not a flag, an outlet whose staff and stock have been
moved elsewhere becomes deletable on its own, with nothing to re-mark.

**Super Admin only, enforced in Postgres.** A `grant delete` and an
`outlets_delete` policy, matching `outlets_insert` and `outlets_update`. The
absence of a button is not the boundary.

**A confirmation dialog before it happens**, using the existing `ConfirmDialog`,
stating that this is not the same as marking an outlet closed.

**The refusal is a sentence.** An owner who tries to delete a populated outlet
must be told what is still attached to it, not shown `employees_outlet_id_fkey`.

## Non-goals

**Cascading anything.** Deletion never removes a dependent row. If something
references the outlet, the delete fails — that is the whole safety property, and
a cascade would convert this feature into the one thing the no-delete doctrine
exists to prevent.

**Changing what "mark closed" does.** The existing deactivation requirement —
that it does not cascade, that accounts and attendance survive, that
reactivation restores everything — is untouched. Delete is a second, different
action for a different situation, not a replacement.

**Making any other table deletable.** The amendment is `outlets` and only
`outlets`, and the doctrine text must be rewritten to say that rather than to
say deletion is now generally acceptable.

**Bulk deletion, or an undo.** One outlet, one confirmation, no recycle bin.

## Production state, verified 2026-07-28 (counts only, read-only)

Measured against the linked production project before this was written, because
the safety argument above depends on facts rather than on the schema's
intentions.

| Outlet | Active | Rows referencing it, across all 17 FKs | Deletable |
|---|---|---|---|
| `(blank)` | yes | 0 | **yes** |
| `skalyani` | yes | 0 | **yes** |
| `skpa` | yes | 0 | **yes** |

`employees` 0 rows · `attendance` 0 · `bills` 0 · `profiles` 2, **both
`super_admin`**, neither scoped to an outlet.

Three consequences, and the first is the important one:

**The foreign-key guard currently protects nothing.** "Deletable only while
nothing references it" is the safety property this whole change rests on, and
today it is vacuous — production has no dependent rows at all, so *every*
outlet is deletable, Kalyani and Kanchrapara included. The confirmation dialog
is the only thing standing between a mis-tap and losing a real outlet. That
does not invalidate the design — the guard becomes real the moment anyone is
rostered — but it does mean the confirmation cannot be treated as a formality,
and it changes the third open question below from a preference into a decision
with teeth.

**A type-the-name confirmation would make the target row undeletable.** The
obvious way to harden an irreversible action is to make the owner type the
outlet's name. The one outlet that most needs deleting has no name. Anything of
that shape must fall back to something a blank row can satisfy.

**Both production accounts are Super Admins.** This change is Super-Admin-only
by design, which today means *everyone* gets the delete action, including the
newly provisioned account whose first session produced the blank outlet. Worth
knowing before deciding how heavy the confirmation is — and worth the owner
knowing independently of this change.

## Open questions to settle in `/opsx:propose`

**Emptying an outlet is not always possible, and the plan assumes it is.**
`profiles` carries `check ((role = 'super_admin') = (outlet_id is null))` — a
Franchise Admin *cannot* be made outlet-less without also changing their role.
So "reassign everyone, then delete" has no clean path for admin accounts
specifically. Decide whether deactivated accounts still block a delete, and
whether that is the right answer.

**How the refusal is worded, and how it stays true.** Catching the foreign-key
violation yields a constraint name like `employees_outlet_id_fkey`. Mapping
table to plain English ("3 people are still on this outlet's staff list") is
cheap, but it is a mapping a human maintains, and a table added later gets no
entry — the exact failure mode `01_schema_coverage.sql` exists to prevent
elsewhere. Decide between a maintained mapping, a generic-but-honest sentence,
and a counting query that enumerates from the catalog.

**Whether an outlet must be closed before it can be deleted.** This was the
softest of the four and the measurement above has hardened it. Requiring it adds
a step and a moment to reconsider. Not requiring it means one confirmation
stands between an active outlet and its removal — and the justification for
that was *"the foreign-key check is doing the real work"*, which is presently
false. Either require closed-first, or make the confirmation carry weight of its
own, but do not ship the light version on a guard that is currently empty.

**Whether the demo shows it.** The mock adapter has no foreign keys, so the
refusal path has to be modelled deliberately or the demo will teach that every
outlet is deletable.

## User-only gate steps

- 🧍 Delete the nameless outlet from production, from the app, and confirm the
  Outlets list is what it should be afterwards.
- 🧍 Attempt to delete a real, populated outlet and confirm the refusal names
  what is still attached and does not read like a crash.

## Docs to update before archiving

- `docs/DATA_MODEL.md` — the no-client-delete invariant, stated twice, must be
  amended to name `outlets` as the single exception and say why.
- `docs/ROLES_AND_PERMISSIONS.md` — the capability matrix gains a *Delete an
  outlet* row: Super Admin only.
- `docs/SCREENS.md` — the Outlets paragraph gains the action.
- `docs/OPERATIONS.md` — the onboarding runbook gains the undo for a mis-created
  outlet, which currently has no answer.
