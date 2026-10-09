# Public Menu

## Purpose

The outlet's live menu as a customer reads it on `shawarmania.in`: a public
address derived from the outlet's name and kept through a rename, read through one
service-role function that puts optional highlights first, retains ordinary
categories and items in the counter's saved order, flags unavailable items, omits
removed ones, answers a closed outlet,
an empty menu and an invented address alike, and carries the outlet's Google
review ask: its link, review discount and whether the menu opens with a popup.

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

It SHALL answer with the outlet's name and address, optional nonempty highlights
first, and ordinary active categories in the counter's saved order. Each section
SHALL use the same existing section shape and each active item SHALL carry its
name, description, price in integer paise, veg flag and whether it is available
— and nothing else:
no ids, no other outlet fields, no discounts. A removed item SHALL be absent; an
unavailable item SHALL be present and flagged, because the customer should see
what is off today rather than wonder where it went. Beside the sections it SHALL
carry `review`: the outlet's review link, review discount percentage and whether
to open with the popup while the outlet asks for a Google review, and null while it does not.

It SHALL answer null — one answer for all three — for an address no outlet holds,
a closed outlet, and an outlet with nothing on its menu, so nothing can be learned
about which outlets exist.

#### Scenario: A customer scans a table's code
- **WHEN** the Worker asks for a trading outlet's address
- **THEN** it receives nonempty highlights first when configured, then that outlet's ordinary active categories and items in the counter's saved order, each item with exactly name, description, price, veg flag and availability, and the outlet's review ask or null

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

### Requirement: Highlighted dishes lead the public menu

The public reader SHALL prepend a nonempty outlet highlights selection as an ordinary section under its configured title, in its independently configured order. It SHALL retain those dishes in their ordinary categories, use the same public projection and current price/availability, omit removed dishes and inactive categories, and omit an empty selection. Item reordering and highlight edits SHALL reach `shawarmania.in/menu/<slug>/` within the existing cache minute without a brand-site deployment.

#### Scenario: A new launch is promoted
- **WHEN** a manager saves Newly Launched with dishes from two categories
- **THEN** the customer menu shows Newly Launched first and both ordinary categories still contain those dishes

#### Scenario: A highlighted dish becomes unavailable or is removed
- **WHEN** it becomes unavailable
- **THEN** both appearances show Unavailable
- **WHEN** it is removed
- **THEN** neither appearance remains and an empty highlights section disappears

#### Scenario: A title matches another category
- **WHEN** a highlights title equals an ordinary category name
- **THEN** the website renders both sections with distinct anchors and functional navigation

### Requirement: An outlet may ask for a Google review on its public menu

Each outlet SHALL hold a Google review ask: whether its public menu asks, the
`https://` link where its Google listing takes a review, and a review discount
percentage, a whole number from 1 to 50, five by default, and whether the menu
opens with a popup or shows only its bottom banner, the popup by default. Every
outlet SHALL start with the ask off. The database SHALL refuse an ask that is on with no link, a link
that is not `https://` or that contains whitespace, a quote or an angle bracket,
and a percentage outside 1–50, whatever the caller.

The owner SHALL set any outlet's ask and a Franchise Admin the asks of the outlets
they manage, through one function that writes these settings and no other column
of the outlet; nobody else SHALL. The percentage SHALL change no bill: the counter
gives it with the ordinary bill discount.

#### Scenario: A manager raises the review discount
- **WHEN** Kalyani's manager saves the Google review section at eight percent
- **THEN** the public menu names eight percent within its cache minute, with no website deploy

#### Scenario: The quieter version
- **WHEN** a manager switches the popup off
- **THEN** the public menu carries `popup: false` and the menu shows only the banner

#### Scenario: An ask with nowhere to go
- **WHEN** a request turns the ask on with no review link
- **THEN** the database refuses it

#### Scenario: Another outlet's manager
- **WHEN** Kanchrapara's manager calls the write for Kalyani
- **THEN** it is refused
