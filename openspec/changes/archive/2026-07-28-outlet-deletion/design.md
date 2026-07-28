# Design: outlet-deletion

> Read [`proposal.md`](proposal.md) first. Tasks reference these decisions as
> D1–D8. Owner decisions taken 2026-07-28 are marked as such.

## D1 — `outlets` becomes the first client-deletable table, and the exception is named

The schema's stated rule, in the grants migration's own header:

> DELETE appears nowhere: nothing in this schema is client-deletable. History
> is voided, soft-deleted, or corrected — never removed.

Restated twice in `docs/DATA_MODEL.md`. This change amends it, and the
amendment must be written down rather than implied by a `grant`.

**What justifies the exception.** The rule protects *history*. An outlet that
nothing references has none: no staff, no attendance, no bills, no stock, no
accounts. Deleting it removes a row and destroys no record of anything that
happened, because nothing happened. That is a genuinely different case from
voiding a bill or deactivating an employee, both of which erase evidence.

**What bounds it.** `outlets`, and only `outlets`. The doctrine text is
rewritten to name the single exception and its precondition, not to say that
deletion is now generally available. A future table wanting the same treatment
argues for itself.

`is_active` remains the answer for an outlet that traded. This change adds a
second, narrower action; it does not replace or weaken the first, and the
existing deactivation requirement is untouched.

## D2 — The foreign key is the guard; nothing counts on its behalf

Seventeen columns across the schema reference `outlets(id)`, and **not one
carries `on delete cascade`**. A populated outlet therefore already refuses its
own deletion, enforced by Postgres, with no flag to maintain and no list to keep
in sync.

Two consequences worth being explicit about:

**No bookkeeping column.** No `is_deletable`, no trigger maintaining a count.
The check is the live referential state, which is what makes the owner's "empty
it and then delete it" work without anything to re-mark.

**The delete is attempted, not predicted.** The UI does not pre-compute whether
a delete will succeed and disable the action accordingly. It attempts it and
handles the refusal (D6). Predicting means duplicating the foreign-key set in
application code, which is the drift `01_schema_coverage.sql` exists to prevent
elsewhere in this repo.

### The guard is presently vacuous, and that shaped D3

Measured in production 2026-07-28: every outlet has **zero** referencing rows —
Kalyani and Kanchrapara included — because `employees`, `attendance` and `bills`
are all empty. The safety property this change rests on protects nothing today.

It becomes real the moment anyone is rostered. But it means the confirmation
cannot be treated as a formality in the interim, which is why D3 exists.

## D3 — Closed first *(owner decision, 2026-07-28)*

**An outlet must be marked closed before Delete is offered.** Deleting an active
outlet in one step is not available.

The alternative — one confirmation between an active outlet and its removal —
was justified by "the foreign-key check is doing the real work", and D2 shows
that is currently false. Closed-first restores a real second moment without
adding a screen, and it reuses a control that already exists and already
explains itself.

It also orders the two actions sensibly: closing is reversible and states what
it does not do; deleting is not reversible and comes after. Somebody who
mis-taps lands on the reversible one.

## D4 — The existing `ConfirmDialog`, and no type-to-confirm *(owner decision, 2026-07-28)*

The confirmation is `ConfirmDialog`, the same component used for deactivating an
outlet and an account. Its `consequence` prop says what deletion does that
closing does not: the row goes, and unlike closing it cannot be undone.

**Type-to-confirm was considered and does not work here.** The standard
hardening for an irreversible action is to make the operator type the record's
name. The outlet that most needs deleting has no name — and no code either,
both being blank. Any confirmation keyed to the record's own identity is
unsatisfiable for exactly the row this change exists to remove.

D3 supplies the deliberation that type-to-confirm would have.

## D5 — A deactivated account still blocks the delete *(owner decision, 2026-07-28)*

The foreign key does not distinguish an active profile from a deactivated one,
and this change does not teach it to. "Nothing references it" stays literally
true, with no exception to explain in the refusal message.

**The consequence, stated plainly so it is not a surprise:** `profiles` carries
`check ((role = 'super_admin') = (outlet_id is null))`, so a Franchise Admin
cannot be made outlet-less without also changing their role. An outlet that has
ever had a manager therefore cannot be emptied by deactivating them — it is
permanently undeletable unless that account is re-roled or removed by a
privileged operation.

That is accepted rather than solved. Providing a detach path is explicitly out
of scope (proposal), because it is an account-lifecycle change wearing a
deletion change's clothes. It is worth a todo if it ever bites.

## D6 — The refusal counts from the catalog *(owner decision, 2026-07-28)*

When the delete is refused, the owner is told what is still attached, by
enumerating the foreign keys that reference `outlets` **from the database
catalog** and counting rows for each.

| Approach | Rejected because |
|---|---|
| Hand-maintained table → English map | Goes stale silently the first time a table is added — the exact failure `01_schema_coverage.sql` exists to prevent |
| Generic "something still references this outlet" | Never wrong, never stale, never actionable |
| **Catalog enumeration** | **Chosen** |

Practically: a `security definer` function that reads `information_schema`,
counts referencing rows for the given outlet, and returns table-and-count pairs.
The surface renders them. A table added later is covered with no code change,
which is the property being bought.

Table names are not prose, so the function returns identifiers and the surface
maps the handful it knows to friendlier words, falling back to the raw name.
Falling back to a table name is acceptable; failing to mention a table at all is
not.

## D7 — The mock must model a refusal it has no foreign keys for

The mock adapter has no referential integrity, so a naive mock deletes every
outlet happily and the demo teaches that outlets are freely removable.

The mock therefore checks its own in-memory collections for references before
deleting, and refuses in the same shape as the database. Demo fixtures must
include **both** cases — an outlet that deletes and an outlet that refuses —
because a demo that only ever shows success is how the refusal path ships
broken.

## D8 — Numbering

This change is first of three unshipped migrations. The numbering for all three
is settled in [`blank-is-not-a-value`'s design D6](../blank-is-not-a-value/design.md);
this change takes migration `20260728000001_outlet_deletion.sql` and pgTAP file
`11_outlet_deletion.sql`. Do not renumber without editing that table.
