# Design: billing-menu-search

## D1. A filter in the browser, not a query

The counter reads the outlet's whole menu once (and keeps the shift's last copy
for offline), so the search is a pure function over that list:
`filterMenu(menu, query)` in `src/features/billing/menu-search.ts`. It works
identically offline, costs no request, and cannot disagree with the tiles the
biller can see.

*Rejected:* a server search. It would add latency at the one surface where
latency is lost money, fail offline, and buy nothing for a list of tens of
items.

## D2. Words, not a substring

The query is split on whitespace and every word must appear, case-insensitively,
in the item's name joined with its category's name. "chee chi" finds *Cheese
Chicken Shawarma*; "burger" keeps everything under *Burgers*, including
*Smashed Veg Burger*, which a biller asked for "burger" expects to see.

*Rejected:* one contiguous substring, which fails "chicken cheese" for *Cheese
Chicken Shawarma*; and fuzzy matching, which reorders and admits near-misses at
a surface where a wrong tile tapped is a wrong order.

## D3. Unavailable items stay in the results

A search that hid a matching unavailable item would read as "we don't sell
that" rather than "we've run out", the same reason the grid keeps it today.

## D4. The search survives a tap; × and Escape end it and drop the cursor

Owner's call. A biller ringing three of the same family of items taps them in
a row; resetting after each tap would make them retype. Clearing blurs the
field so a touch keyboard closes rather than covering the grid it restored.

## D5. Escape is claimed only when nothing else wants it

Escape already does three things on the counter surface, found by reading
every key handler in `src/`:

- an open native `<dialog>` (every billing pop-up, via `Modal`) closes;
- the account menu (`<details>`) closes;
- a pipeline card's actions menu (`role="menu"`) does not react to Escape at
  all today.

The search listens on `document` only while it holds a query, and does
nothing when the key carries a modifier, was already handled
(`defaultPrevented`), when any `dialog[open]`, `details[open]` or
`[role="menu"]` is present, or when focus is in another input or textarea.
Checking the DOM at the moment of the key, rather than tracking each owner's
state, means a new dialog or menu built on the platform elements is respected
without being told about the search.

*Rejected:* Escape only while the field has focus. A tap on a tile moves focus
away, and the search outlives that tap, so the shortcut would stop working at
exactly the moment it is wanted.

## D6. The menu column scrolls, the search stays pinned

The column already scrolls (`overflow-y-auto`); the requirement and its e2e
check that it never had to are retired. The search bar is `sticky` at the top
of the column, with padding equal to the focus ring's 3px, because the
column's scroll clips anything drawn past its edge and a flush field kept only
the bottom of its ring.

## Money, tenancy, offline

None touched. No table, policy, arithmetic or outbox change; the filter runs on
data already in memory, offline included.
