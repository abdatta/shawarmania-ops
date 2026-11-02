# Proposal: needs-attention-hides-when-empty

> **Model**: Opus · **Kind**: small correction, not a roadmap change · corrects `attention-badges` · **Gate**: none — a section of the owner's and manager's Overview, away from the counter's run time, and a revert cleanly undoes it; the Overview attention test fails with the fix reverted.

## Why

With nothing waiting, Overview still drew a **Needs attention** card that said *Nothing waiting* (owner, 2026-11-02). A section whose only job is to point at work earns its place only when there is work; an empty one is a heading to read past.

## What Changes

- Each row of Needs attention reports its count to the section. Once every row has read and none has anything waiting, the section is left out (`hidden`), heading and all. The *Nothing waiting* line is gone.
- While any row is still loading, the section stays and shimmers, as it does today, so it never flashes empty before the first count arrives.
- `docs/SCREENS.md` says so, and its Overview source-link sentence now names Sales on Month for the month's revenue (left behind by `revenue-tile-opens-analytics`).

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It changes whether a section is drawn and writes nothing.

## Non-goals

- Rows, counts, tones and order are unchanged.
- The counter's own *needs attention* (sync status, My shift) is a different thing and is untouched.
