## ADDED Requirements

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
what is off today rather than wonder where it went.

It SHALL answer null — one answer for all three — for an address no outlet holds,
a closed outlet, and an outlet with nothing on its menu, so nothing can be learned
about which outlets exist.

#### Scenario: A customer scans a table's code
- **WHEN** the Worker asks for a trading outlet's address
- **THEN** it receives nonempty highlights first when configured, then that outlet's ordinary active categories and items in the counter's saved order, each item with exactly name, description, price, veg flag and availability

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
