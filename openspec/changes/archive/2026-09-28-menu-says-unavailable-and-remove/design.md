# Design: menu-says-unavailable-and-remove

## D1 — Verbs on the actions, a state on the badge

The row menu lists things a manager can *do*, so each entry is a verb phrase that
says what will happen: **Mark unavailable**, **Mark available**, **Edit**,
**Remove**. The badge beside the name describes what the item *is*, so it is the
state: **Unavailable**. A bare *Unavailable* / *Available* in the menu would read
as a status rather than an action, and a toggle word such as *Turn off* is what
made the two actions look alike in the first place.

**Unavailable** is used on every surface that shows the state — the Menu screen,
the counter tile and, from `the-menu-is-public`, the customer's menu — so the
kitchen, the till and the table all say the same word.

## D2 — `remove_menu_item`, with `retire_menu_item` kept for one release

The command is renamed so the code says what the screen says. It cannot simply
be renamed in the database, because **the app is an installed PWA**: a tablet
keeps running the build it has until it adopts the update, and a migration lands
before any of them do. A tablet on the previous build calling `retire_menu_item`
after the rename would fail a manager's Remove with "could not be saved".

So the migration renames the function to `remove_menu_item` and recreates
`retire_menu_item` as a one-line wrapper that calls it, with the same grants. The
wrapper is dropped by a follow-up once every counter has taken this build; that
follow-up is recorded in `openspec/todos/drop-retire-menu-item.md`.

## D3 — The counter tile

The tile's price slot held a short uppercase **OFF**. **Unavailable** is three
times as long, and the tile's name is never truncated, so the word is set in
normal case at the badge's smaller size rather than tracked capitals: it takes
the slot a four-digit price takes, and the name beside it keeps its width. The
tile's accessible name ends "— unavailable".

## D4 — Test ids

`retire-<id>` becomes `remove-<id>`, matching the label. `toggle-<id>` names
neither word and stays; `unavailable-<id>` already said the new word.
