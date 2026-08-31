# Proposal: The duplicate row's separators read as separators

> **Model**: Sonnet · **Kind**: production bug fix, not a roadmap change ·
> **Gate**: The possible-duplicate-expense row on the Delivery surface separates
> its amount, date and note with `·` rather than `Â·`, and the file it lives in
> carries no byte-order mark.

## Why

The owner's Delivery surface shows a possible duplicate expense as two rows,
side by side, each with its own amount, date and note — because a typed figure
is rounded and a typed date records when a bill was noticed rather than when it
was paid, so only a person can judge whether the two are the same purchase.

Those three parts are separated by a middle dot, and since 24 August the dot has
rendered as `Â·`:

> ₹3,750 Â· 15 Aug Â· Hyperpure, paid online

`aggregator-settlement-sync` requires that *"the surface SHALL present both rows
with their own amount, date and note"*, and this is the one row on the surface
whose whole job is to be read carefully by somebody deciding about money.

The cause is not a typo anybody made. Commit `258644d` rewrote the file through
a tool that read its UTF-8 as Latin-1 and re-encoded the result, so `·`
(`C2 B7`) became `Â·` (`C3 82 C2 B7`); the same write stamped a UTF-8 byte-order
mark at byte 0. The BOM is the fingerprint of that pass rather than a second
fault, and it is the only one on a source file in the repo.

## What Changes

- The two `Â·` in `sync-event-row.tsx` become `·`.
- The byte-order mark is stripped, so the file matches every other source file
  and the next tool that opens it has no reason to repeat the round trip.
- The Zomato channel suite asserts the duplicate row's text carries no `Â`.

## Non-goals

- **The archived evidence markdown keeps its BOMs.** Five files under
  `openspec/changes/archive/2026-08-25-swiggy-settlement-sync/evidence/` carry
  one. The archive is immutable by rule and nothing renders those files to a
  reader, so rewriting them would be churn against a rule for no gain.
- **No repo-wide encoding lint.** One file over the project's life is not a
  pattern worth a gate; the assertion below catches this row specifically, which
  is where it would be noticed and where it costs money to miss.
- No change to what the duplicate row says, what it offers, or how the two
  expenses are matched.
