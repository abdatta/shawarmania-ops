# Proposal: outlet-scope-narrowing-keeps-the-set

> **Model**: Opus 5 · **Kind**: production bug fix, not a roadmap change · **Gate**: choosing one outlet on a single-outlet surface, where that outlet is already in the remembered selection, leaves the wider selection intact and returns to the multi-outlet surface with every chip still lit.

## Why

The remembered outlet selection is shared by every outlet-scoped surface, and a
single-outlet surface writes its choice over the whole of it. So a person who
selects both outlets on Attendance, opens the Ledger, and picks one of those two
outlets there, comes back to Attendance narrowed to one — without ever asking to
be. The narrowing was never a decision; it is the single-select surface having no
way to say "this one, for now" rather than "only this one, everywhere".

Picking an outlet that is *not* in the selection is a different act, and stays
what it is: a move somewhere else, which every surface follows.

## What Changes

- A pick already inside the remembered selection reorders it to lead rather than
  replacing it, so the wider selection survives and the single-outlet surface
  still reopens on the outlet that was actually chosen.
- A pick outside the selection replaces it, exactly as today.

## Non-goals

- No new control, and no multi-select on any surface that does not have one.
- No change to what a selection confers, which remains nothing: the database
  decides every read and write from the assignment.
- No change to how or where the selection is stored.
