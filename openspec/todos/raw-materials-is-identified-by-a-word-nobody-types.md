# Raw Materials Is Identified By A Word Nobody Types

**Type**: Design gap · **Status**: Open · **Area**: Reporting

## The expectation

The profit figure offers two bases, and the consumption basis exists to count
food exactly once: stock **bought** is left out of the running costs, and stock
**used** is subtracted at what it cost. The screen says so in as many words.

## The observed behaviour

Nothing decides which expenses are stock purchases except an exact match against
the single word `raw_materials`, which used to be one value of a closed list.
Categories are free text now, and nobody types that. A person buying chicken
types `Chicken`, or the supplier's name.

So the moment real expenses exist, every one of them counts as a running cost
**and** the stock consumed is subtracted beside them. Food is charged twice, the
"not subtracted on this basis" note never appears against any line, and the
figure still calls itself a consumption basis. A profit figure that misstates
its own basis is the one thing the reporting contract says must not happen.

Today this is invisible: the P&L is demo-gated, the live expense record is
empty, and the demo fixtures still carry the old word, so the demo reads
correctly and proves nothing.

## Why this is not trivial

Free text cannot answer "was this stock?" — that is a different question from
"what shall we call it?". `Chicken` and `Hyperpure` are both stock and look
nothing alike, while `Staff Food` is food that is not stock. So this is not a
matter of picking a better word to match on.

Whatever replaces it has to survive the rename and merge operations, which move
a category's text across history in one transaction. A second attribute that
does not travel with those rewrites would drift silently, which is the failure
the snapshot rule was written to avoid in the first place.

Two shapes worth weighing, neither free: a **flag on the expense row** captured
when it is recorded, which asks the person at the counter a question they can
answer; or a **flag on the suggestion** so a category is marked as stock once,
which asks nobody but is wrong for a category used both ways.

## Trigger to promote

**Dissolved on 26 Aug 2026, not fixed.** Inventory is shelved
(`openspec/todos/inventory-is-shelved.md`), so there are no movements to count
and the consumption basis cannot be computed at all.
`retire-the-manual-ledger` (#12) therefore withdraws the basis rather than
repairing a matcher that feeds it, which is the alternative this note called more
expensive than waiting and which shelving has made free.

Nothing here needs doing. If inventory ever returns, this note returns with it,
and the fix is part of that change: match against the free-text category snapshot
the promoted expense table actually holds.
