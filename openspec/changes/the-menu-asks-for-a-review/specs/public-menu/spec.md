## ADDED Requirements

### Requirement: An outlet may ask for a Google review on its public menu

Each outlet SHALL hold a Google review ask: whether its public menu asks, the
`https://` link where its Google listing takes a review, and a review discount
percentage, a whole number from 1 to 50, five by default. Every outlet SHALL start
with the ask off. The database SHALL refuse an ask that is on with no link, a link
that is not `https://` or that contains whitespace, a quote or an angle bracket,
and a percentage outside 1–50, whatever the caller.

The owner SHALL set any outlet's ask and a Franchise Admin the asks of the outlets
they manage, through one function that writes these settings and no other column
of the outlet; nobody else SHALL. The percentage SHALL change no bill: the counter
gives it with the ordinary bill discount.

#### Scenario: A manager raises the review discount
- **WHEN** Kalyani's manager saves the Google review section at eight percent
- **THEN** the public menu names eight percent within its cache minute, with no website deploy

#### Scenario: An ask with nowhere to go
- **WHEN** a request turns the ask on with no review link
- **THEN** the database refuses it

#### Scenario: Another outlet's manager
- **WHEN** Kanchrapara's manager calls the write for Kalyani
- **THEN** it is refused

## MODIFIED Requirements

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
carry `review`: the outlet's review link and review discount percentage while the
outlet asks for a Google review, and null while it does not.

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
