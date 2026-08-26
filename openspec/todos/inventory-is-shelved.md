# Inventory Is Shelved

**Area:** Inventory / Reporting · **Raised:** 26 Aug 2026 · **Type:** Scope
decision, not a defect

## What was decided

**Inventory is not part of the app.** The owner shelved it on 26 Aug 2026, in
full, as optional work to be reconsidered only if the business asks for it.

Nothing is being removed from production, because nothing was ever there. The
Stock surface built in `ui-outlet-operations` (#7) has been `demo` since the day
it landed, which means real users have never seen a navigation entry or a
reachable route for it. Shelving is therefore a documentation act, not a
deletion: the surface stays behind its demo gate, the `inventory-ledger`
capability spec stays where it is, and neither is scheduled.

## What it took with it

- **Roadmap #11 `expenses-and-inventory-live` no longer exists.** Its expense
  half had already been delivered by `manual-ledger-stopgap` (#36) and
  `the-ledger-opens-to-the-outlet` (#38), which put real expense rows in front of
  the people who spend the money. Its inventory half is this note. With both
  halves gone the change had no content, and the number was reused by
  `cash-is-counted-not-closed`.
- **The consumption-basis P&L is withdrawn**, by `retire-the-manual-ledger`
  (#12). It exists to count food used rather than food bought, which requires
  inventory movements. With no movements it computes nothing, and a named basis
  that returns nothing is worse than one basis honestly offered. It returns with
  inventory or not at all.
- **`raw-materials-is-identified-by-a-word-nobody-types.md` dissolves with it**
  rather than being fixed. The matcher looked for a value of a category enum
  that free-text categories replaced, so it had been matching nothing since
  `expense-categories-grow-from-use` (#37). There is now nothing for it to
  protect.

## What would bring it back

A concrete operational need, stated by the business, in one of these shapes:

- Stock is running out mid-service often enough that somebody wants a threshold
  warning.
- The owner wants to know food cost as consumption rather than as purchase, and
  is willing to have somebody record what was used.
- A third outlet makes central purchasing worth tracking.

**Trigger**: any of the above. Not sooner. Seed it via `/opsx:propose` when one
fires, and expect the consumption basis and the raw-materials rule to come back
as part of that change rather than separately.

## What to do when reading old material

Archived changes and their specs describe inventory as forthcoming, and they are
left alone as the dated record they are. Live documentation should not: if a
page in `docs/` or a live capability spec still implies stock is on the way,
that is drift worth fixing.
