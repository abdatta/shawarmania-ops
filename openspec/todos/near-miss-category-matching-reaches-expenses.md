# A Near-Miss Category Should Be Caught In Expenses Too

**Type**: Feature · **Status**: Open · **Area**: Expenses

## The expectation

Recording an expense under a category that is a misspelling of one the business
already uses should offer the existing one before a second spelling is created,
the way the menu editor now does. Picking the offered category should record the
expense under it, with its existing spelling, without the form being reopened.

## The observed behaviour

An expense category is free text that the business grows from use, and the field
offers the business-wide list while somebody types. That list is filtered by
substring, so a typo takes it to empty — which reads as "there is no such
category" at exactly the moment somebody is about to create a duplicate of one
they already have. Nothing compares the typed word to the list, and nothing is
confirmed: "Vegtables" beside "Vegetables" is recorded silently.

The cost is not cosmetic. A month's breakdown groups by stored category text, so
two spellings are two lines that should have been one, and every figure read off
that breakdown is split. Unlike the menu, the fix afterwards is an owner-only
retroactive merge that rewrites recorded rows — the correction is genuinely more
expensive here than it is on a menu heading.

## What already exists to build on

`billing-live` (#10) built this for the menu and left the reusable half in the
domain layer: a matcher that folds case, accents, punctuation and spacing, then
finds the same name spelled differently, a singular beside a plural, a
transposition or a dropped letter, and one name sitting inside another. The
dialog that presents the candidates as a pick-then-confirm choice is a component,
not menu code. Both are already shared, so this item is adoption rather than
design.

## Constraints

- **The comparison list is business-wide, not outlet-scoped**, which is the
  opposite of the menu's. A manager at one outlet must be offered a category
  another outlet created, or the split this exists to prevent happens across
  outlets instead of within one.
- **It must not become a refusal.** A category is free text and the existing
  double-count warning is deliberately dismissable, because a refusal is defeated
  by a different spelling that the month would then count with nothing to warn
  about. This must behave the same way: creating the typed name stays available.
- **Where nothing matches, nothing is asked.** An expense is recorded in a hurry
  with a receipt in hand, and a dialog on every new category is read on none of
  them.
- It must compose with the existing commission and drawer-movement warning
  rather than replacing it — those are about where a figure belongs, not about
  how it is spelt.
- Retired categories are still valid on a recorded expense, so whatever the
  comparison offers must not imply the typed value will be refused.

## Trigger to promote

`expenses-and-inventory-live` (#11), which puts the first real expense rows
behind the month's breakdown. Doing it there is cheap; doing it after means the
first duplicate spellings already exist and someone is merging them.
