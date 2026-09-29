# Public Menu

## Purpose

The outlet's live menu as a customer reads it on `shawarmania.in`: a public
address derived from the outlet's name and kept through a rename, read through one
service-role function that returns active sections and items in the counter's
order, flags unavailable items, omits removed ones, and answers a closed outlet,
an empty menu and an invented address alike.

## Requirements

### Requirement: Every outlet has a public menu address, derived from its name and kept

Every outlet SHALL have exactly one public menu address, its `menu_slug`, and
the brand site SHALL serve that outlet's menu at `shawarmania.in/menu/<slug>/`.
The address SHALL be derived from the outlet's name when the outlet is created,
as lowercase letters and digits with words joined by single hyphens, so nobody
has to invent one. It SHALL then be **stored and kept**: renaming the outlet SHALL
NOT move it, because printed QR codes on the tables carry it.

The database SHALL refuse two outlets holding the same address, and an address
that is not URL-safe or is longer than sixty characters. A new outlet whose name's
address is already held SHALL be given the next free one (`-2`, `-3` …) rather
than be refused. The owner MAY choose a different address; a blank address on an
edit SHALL keep the one the outlet has rather than un-publish its menu.

The address SHALL NOT be the outlet's short code. The code is internal shorthand
the owner edits freely and staff codes derive from; tying the public address to
it would let an edit silently break every printed code.

#### Scenario: A new outlet
- **WHEN** the owner creates an outlet named Kalyani Cafe without typing an address
- **THEN** its public menu address is `kalyani-cafe`, and the Outlets form showed that address before it was saved

#### Scenario: The same name twice
- **WHEN** an outlet is created with a name whose address another outlet already holds
- **THEN** it is given the next free address, and is not refused

#### Scenario: An outlet is renamed
- **WHEN** the owner renames an outlet
- **THEN** its public menu address is unchanged, and every printed QR code still opens its menu

#### Scenario: The address is cleared
- **WHEN** the owner saves an outlet with the address field blank
- **THEN** the outlet keeps the address it had

#### Scenario: A hand-crafted write
- **WHEN** a request sets an address another outlet holds, or one with spaces or symbols
- **THEN** the database refuses it, whatever the form did

### Requirement: The public menu is read through one service-role function

A customer's menu SHALL be read only through `public_menu(slug)`, executable by
the service role and by no client role — neither `anon` nor `authenticated` —
exactly as the public receipt is. The brand site's Worker SHALL hold the
credential; no browser SHALL.

It SHALL answer with the outlet's name and address and, for each active section
in the counter's order, each active item in order with its name, description,
price in integer paise, veg flag and whether it is available — and nothing else:
no ids, no other outlet fields, no discounts. A removed item SHALL be absent; an
unavailable item SHALL be present and flagged, because the customer should see
what is off today rather than wonder where it went.

It SHALL answer null — one answer for all three — for an address no outlet holds,
a closed outlet, and an outlet with nothing on its menu, so nothing can be learned
about which outlets exist.

#### Scenario: A customer scans a table's code
- **WHEN** the Worker asks for a trading outlet's address
- **THEN** it receives that outlet's active sections and items in the counter's order, each with exactly name, description, price, veg flag and availability

#### Scenario: The kitchen ran out
- **WHEN** an item is marked unavailable
- **THEN** the public menu lists it, flagged unavailable

#### Scenario: An item was removed
- **WHEN** an item is removed from the menu
- **THEN** the public menu does not list it

#### Scenario: A closed outlet, an empty menu, an invented address
- **WHEN** the Worker asks for any of them
- **THEN** it receives null, the same for all three

#### Scenario: A session tries to call it
- **WHEN** an anonymous request or any signed-in session, the owner's included, calls `public_menu`
- **THEN** it is refused
