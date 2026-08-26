# Surface the billing Status count on its own tab

> **Model**: Opus 5 · **Kind**: small correction, not a roadmap change · **Gate**: **the Status tab names its own refused-command count while the panel behind it is shut**, reading in the same parentheses its two neighbours already use, staying a plain name when nothing was refused, and never disagreeing with the panel's own heading.

## Why

The Status tab holds the only reading of whether a tablet's billing work reached
the server, and it is the one tab of three that says nothing about its contents
while closed. `Bills (24)` and `Open orders (0)` both carry their counts, so a
manager learns there is a refusal to look at only by opening a tab that looks
exactly as quiet as it does on a clean day. The first refusal in production, a
duplicate payment the database correctly declined, sat unread behind that tab.

The count is already computed. The panel derives it from the diagnostics the
screen has held in state since it loaded; nothing new is read to show it.

## What changes

- Give `manager-sync-status.tsx` two exports over its existing private
  predicate: the refused diagnostics as a list, and their count. The panel
  renders the list it is handed, so the tab's number is the length of exactly
  what the panel shows and the two cannot be derived apart.
- Let the Status tab carry that count in the page's own parentheses, and only
  when it is non-zero.
- Update the two existing status tests to match the tab by prefix, so they keep
  asserting order and totals rather than the label's punctuation.

## Non-goals

- **Not an attention badge.** `attention-badges` reserves a badge for work the
  reader can act on and forbids one for "a condition that resolves on its own".
  A manager cannot clear a refusal from this screen: `result_category` is written
  once and never updated, and the row leaves only by ageing out of the rolling
  window the panel reads. A `Badge` here would be a status light, which that
  spec names and refuses. The parentheses carry the number without claiming the
  reader can clear it.
- **No change to what counts as a problem.** `ROUTINE_RESULTS` keeps its present
  membership, including the three categories the database never writes. Retiring
  those belongs with the acknowledgement work that would make a real badge
  honest.
- **No date scoping.** The panel's undated window is unchanged, so the tab
  inherits it: the count is the same on every date until the row ages out. The
  tab reads whatever the panel would show, which is the property under test, and
  it follows for free when the window is later scoped.
- Nothing about the counter tablet's own delivery, the outbox, or the race that
  produced the duplicate payment. That is its own change.
