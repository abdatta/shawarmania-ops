# Proposal: a-menu-opens-where-it-can-be-read

> **Model**: Opus · **Kind**: production correction, not a roadmap change ·
> **Gate**: a pipeline card's menu opened with its trigger at the top of the
> window opens below it, inside the window; a row menu opened with its trigger
> at the bottom opens above it, inside the window; a row menu opened just above
> the phone's bottom bar opens above it, clear of the bar; a menu opened while its card
> is sliding ends beside its trigger; the pinning tests fail on the tree before
> the change; phone and tablet, light and dark, checked in a real build.

## Why

A pipeline card's **More actions** menu always opens above its trigger, and a
row's actions menu (Team, Expenses, Menu) always opens below. Each is placed in
the window rather than in its scrolling box, which is right, but neither looks
at how much window there is. At 1280 × 720 the counter page is 140 px taller
than the window, so a biller who has scrolled down to the expenses and opens the
menu on the top card gets a menu wholly above the screen: Edit and Cancel order
are there and cannot be reached until they scroll back up and open it again. A
row menu near the foot of a list does the same below the screen.

It was found by a test, not a biller (`served-spec-waits-for-the-other-till`,
2026-10-08): a click Playwright retried scrolled the top card's trigger to the
top of the window, and the menu opened off it. The test is fixed; this is the
screen it exposed.

## What Changes

- A menu opens on its usual side when it fits there, on the other side when it
  does not, and is held inside the window with a small margin either way. The
  pipeline card still prefers above; a row menu still prefers below.
- "The window" means what a person can read: the phone's bottom bar and the
  demo counter's banner are fixed over its edges, and a menu treats them as the
  edge. A row just above the bar has no room below it [owner, 2026-10-08].
- A menu stays beside its trigger while it is open: through a scroll, a resize,
  and a card sliding into a freed place when another order leaves the rail.
- Both menus take their position from one placement rule, so a third menu
  cannot be written with the old one-sided arithmetic.

## Non-goals

- No change to what either menu offers, its rows, its sizes, or how it closes.
- No portal: the menu stays inside its card or row, where every test and
  assistive reading already finds it.
- The account menu is a `<details>` panel that is not `position: fixed`, and is
  not touched.

## Docs

- `docs/DESIGN_SYSTEM.md`, component conventions: where a menu opens.
