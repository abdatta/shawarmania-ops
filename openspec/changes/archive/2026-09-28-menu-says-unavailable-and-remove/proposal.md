# Proposal: menu-says-unavailable-and-remove

> **Model**: Opus · **Roadmap**: deliberately unlisted — a rename of a shipped
> surface, not new capability · **Gate**: on the Menu screen an item's actions
> read **Mark unavailable** / **Mark available**, **Edit** and **Remove**; an
> unavailable item is labelled **Unavailable** there and on the counter's tile,
> where the word stands in place of the price; Remove confirms as "Remove
> *item*?" with a **Remove item** button; the database's removal command is
> `remove_menu_item`, and the previous `retire_menu_item` still works for an
> installed app that has not yet taken the update; no behaviour changes; the
> living specs and `docs/` say the same words.

## Why

The owner could not tell the two menu actions apart [owner, 2026-09-28]. The row
menu offered **Turn off** and **Retire**, and the item then showed **OFF** — and on
the counter, **Off**. *Off* does not say whether the item is gone for good or only
sold out today, and *retire* is not a word anyone at a counter uses. The owner's
words, adopted as they were given: **Unavailable / Available** for the temporary
state, and **Remove** for the permanent one.

The public menu (`the-menu-is-public`, next) shows the same state to customers as
"Unavailable", which is a further reason for the staff screens to use that word
and no other.

## What changes

- The Menu screen's row actions read **Mark unavailable** or **Mark available**,
  **Edit**, and **Remove**.
- An unavailable item's badge reads **Unavailable** instead of **OFF**, on the Menu
  screen and on the counter's menu tile, whose accessible name ends
  "— unavailable" instead of "— off the menu".
- Remove confirms with "Remove *item*?" and a **Remove item** button. What it does
  is unchanged: the row is kept for the bills that name it, and it leaves the menu
  for good.
- The adapter method is `removeItem`, and the database command is
  `remove_menu_item`. `retire_menu_item` remains as a forwarding wrapper for one
  release (design D2).
- The living specs and `docs/` say the same words.

## Non-goals

- **No behaviour change.** Availability is still one tap in place; removal is
  still a soft delete that keeps `is_active = false` rows for history; a Biller's
  write is still refused by policy.
- **No column renames.** `is_available` and `is_active` name the facts, not the
  words on the buttons.
- **Other uses of "retire" stay.** Expense-category suggestions, the manual
  ledger, retired counter devices and retired surfaces are different things, and
  history is not rewritten: archived changes, dated roadmap rows and old
  migrations keep the words they were written with.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md` — wherever they
name the menu actions or the counter's marker. The specs via this folder's deltas.

## How to run the gate

`format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`; `test:db` for the
function rename (in CI); a browser check of the Menu screen and the counter in
demo mode, light and dark; a final search for the old words that finds only the
kept uses listed in `tasks.md`.
