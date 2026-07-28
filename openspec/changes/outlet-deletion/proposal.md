# Proposal: outlet-deletion

> **Model**: Opus · **Wave**: B · **Depends on**: #15 · **Gate**: **an outlet with nothing attached to it is deleted from the app by the owner**, and one with anything attached refuses with a sentence naming what is still there — the refusal proved by a hand-crafted request, not by observing a disabled button.

## Why

An outlet created by mistake is permanent. There is no way to remove one from
the app, and there is no way to remove one from the database either — `DELETE`
is granted to no client role on any table.

This is not hypothetical. A newly provisioned manager created a nameless outlet
during their first session; it sits in production, appears in the owner's list,
and cannot be taken out. `blank-is-not-a-value` (#19) stops the next one being
created. It does nothing about the one that exists, or about an outlet created
correctly and then genuinely not needed.

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

**Whether an outlet must be closed before it can be deleted.** Requiring it adds
a step to a two-step flow and a moment to reconsider. Not requiring it means one
confirmation stands between an active outlet and its removal — which is only
safe *because* the foreign-key check is doing the real work.

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
