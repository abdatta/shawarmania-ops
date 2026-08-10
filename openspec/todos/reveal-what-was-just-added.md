# A Freshly Added Row Should Come Into View And Say So

**Type**: Feature · **Status**: Open · **Area**: Design system

## The expectation

After adding something, the person who added it should see it appear. The list
should move to it, and it should be marked as new for a moment.

## The observed behaviour

The form closes and the list re-reads. Where the new row landed is not the
reader's problem to solve, but it becomes one: added rows go to the bottom of
their group, or into whatever order the list already sorts by, and on a phone that
is frequently below the fold. Nothing moves, nothing is marked, and the screen
looks the same as it did before.

The failure this causes is not mild confusion. Somebody who cannot see what they
just added concludes it did not save and **adds it again** — so the cost is
duplicate rows in real records, found later by whoever is reconciling them.

## Why this is worth doing once, centrally

Every add flow in the app has the same shape and the same gap: the outlet expense
list, stock items, stock movements, people, outlets, and expense categories. Six
surfaces across five capabilities, each with its own list, its own sort order and
its own form.

Fixing them one at a time produces six slightly different behaviours. The useful
unit is one primitive — reveal a row by identity, mark it briefly — adopted by
each surface, so a reader who learns what the flash means on one screen already
knows it everywhere.

## Constraints

- **The highlight is decoration and must respect `prefers-reduced-motion`. The
  scroll is orientation and must not** — somebody who has asked for less motion
  still needs to be shown where the row went.
- It must survive the list re-reading from the adapter, so the row is found by its
  identity rather than by a position captured before the write.
- A row already in view must not be scrolled to. Moving a list under somebody who
  can already see what they are looking at is worse than doing nothing.
- It must not depend on the row being last. Several of these lists sort by name or
  by date, so "added" and "at the bottom" are not the same thing.

## Trigger to promote

Any time — nothing depends on it and it blocks nothing. Deliberately kept out of
`billing-live` (#10): that change turns real billing on at a real counter over two
watched nights, and six unrelated surfaces is not what should be under review on
those nights. #10 builds the primitive for the menu editor, where appending a
category puts it off screen; this item is that primitive reaching the rest.
