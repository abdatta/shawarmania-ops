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

**The schema already proves it, for free.** Seventeen columns across the schema
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

**Both production accounts are Super Admins**, which the owner has confirmed is
intended — the second account is a co-owner, not a manager. That is what let it
create an outlet at all, since `outlets_insert` requires `super_admin`, and it
means this change's delete action reaches both accounts on day one. Recorded
because the role is the whole authorisation story here, not because it is
wrong.

**The empty `employees`, `attendance` and `bills` tables are not evidence that
#5's gate went unwalked.** Real check-ins happened and the rows were removed
afterwards with the service-role credential, which is the only thing that can
delete them. Noted so the emptiness is not re-litigated by the next person to
look.

## Settled by the owner, 2026-07-28

The four questions this seed carried were answered before the design was
written. Recorded here because each has a cost that a later reader should see
was accepted deliberately.

**An outlet must be marked closed before it can be deleted.** The reversible
action precedes the irreversible one. This is a direct consequence of the
measurement above: the argument for a one-step delete was that the foreign-key
check does the real work, and today it does not.

**The confirmation is the existing `ConfirmDialog`, with no type-to-confirm.**
The standard hardening — type the record's name — is unsatisfiable for the one
row this change exists to remove, which has neither a name nor a code. The
closed-first step supplies the deliberation instead.

**A deactivated account still blocks a delete.** "Nothing references it" stays
literally true. The accepted cost: `profiles` cannot be outlet-less in a scoped
role, so an outlet that has ever had a Franchise Admin cannot be emptied by
deactivating them.

**The refusal counts from the database catalog**, not from a maintained mapping
of table names to English. A table added later is covered without anyone
remembering — the same instinct that makes the isolation suite read the catalog.

**Detaching accounts from an outlet stays out of scope**, so "empty it, then
delete it" remains a property of the foreign keys rather than a flow this change
provides.

## Open questions carried into implementation

Smaller than the ones above, and none of them blocks a start.

**Which table names get friendlier words.** The refusal returns identifiers.
A handful — `employees`, `profiles`, `counter_devices` — deserve a phrase a
person would say. The rest can fall back to the raw name. Falling back is
acceptable; omitting a table because nobody wrote a phrase for it is not.

**Whether `01_schema_coverage.sql` needs teaching about the new verb.** It
enumerates the schema and fails on a table that opts out of its expectations.
A table that is now deletable by a client may or may not trip it. Find out by
running it rather than by reading it.

**What the Outlets card actually renders for a blank row.** Its heading is the
name and its badge is the location label, both empty on the target outlet, and
its test id is keyed to the code. It needs to be identifiable enough to act on —
this is the one row the whole change exists to remove, and it must not be the
one row that is hard to click.

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
