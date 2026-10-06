# Proposal: billing-menu-search

> **Model**: Opus · **Kind**: small counter capability, not a roadmap change ·
> **Gate**: typing in the counter's menu search narrows the grid to the items
> whose name or category holds every word typed, with no request leaving the
> browser; the search outlives a tap on a tile and is cleared only by its ×
> or by Escape, either of which drops the cursor; Escape never clears it while
> a dialog or a menu is open, nor from another text field; the menu column
> scrolls under a search bar that stays in reach.

## Why

The menu has outgrown one screen [owner, 2026-10-06]. The counter was designed
for seven items against a stated ceiling of twenty, so it has no search and a
build test that fails when the grid needs scrolling. One outlet now sells sixty
items across ten categories, and a biller looking for *Nashville Chicken Wings*
has to scroll a column of tiles to find it.

## What Changes

- A search field sits at the top of the counter's menu column, with a × on its
  right once something is typed. It stays pinned while the column scrolls.
- Typing narrows the grid **in the browser**, over the menu the counter already
  holds: every word typed must appear in the item's name or its category's, in
  any order and case. A category with nothing left is hidden; an unavailable
  item that matches stays, dashed and unsellable as before. Nothing matching
  says so in one line.
- **The search stays until the biller clears it** [owner, 2026-10-06]. A tap on
  a tile adds the item and leaves the filter in place, so a run of taps on the
  same few items needs no retyping.
- **× or Escape clears it, and drops the cursor** [owner, 2026-10-06], so a
  touch screen's keyboard goes away with the search instead of covering the
  grid it restored. Escape clears it from anywhere on the surface, but only
  when nothing else claims the key: an open dialog closes instead, the account
  menu closes instead, an open actions menu on a pipeline card is left alone,
  and a key pressed in another text field stays that field's.
- The menu column scrolls when the menu does not fit. The requirement that the
  whole menu be visible at once, without a search, is replaced.

## Non-goals

- No server-side search, and nothing persisted: a reload starts empty.
- No Enter-to-add when one item matches [owner, 2026-10-06].
- No shortcut to focus the search, and no type-anywhere-to-search.
- No fuzzy matching, transliteration or match highlighting.
- No change to the demo's menu or settings; that is a separate change.

## Docs to update before archive

- `docs/SCREENS.md` — the counter's design commitments: the menu is searched,
  not guaranteed to fit.
- `docs/BUSINESS_CONTEXT.md` — the "small menu" implication.
- `docs/LIMITATIONS.md` — the description trade-off no longer rests on the menu
  fitting one screen.
