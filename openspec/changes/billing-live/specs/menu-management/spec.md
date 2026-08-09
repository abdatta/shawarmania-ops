## ADDED Requirements

### Requirement: The menu is a real record a manager creates and maintains in the app

An authorised manager SHALL create, rename, reprice, reorder, mark unavailable and
retire menu categories and items for an outlet they are entitled to, entirely
through the application and with no SQL. Prices SHALL be entered and stored in
integer paise. A retired or unavailable item SHALL disappear from the counter
without altering any bill or order line already captured.

**A gate must be reachable from an empty database.** Billing cannot go live at an
outlet until that outlet's menu exists, and it must have arrived by a route a new
franchisee could repeat.

#### Scenario: The owner enters an outlet's menu
- **WHEN** a Super Admin creates that outlet's categories, items and prices through the menu surface
- **THEN** those items are immediately sellable at that outlet's counter and at no other outlet

#### Scenario: A price is corrected
- **WHEN** a manager changes an item's price
- **THEN** lines added afterwards use the new price and every captured order line and settled bill is unchanged

#### Scenario: An item is taken off
- **WHEN** an item is marked unavailable
- **THEN** it cannot be added at the counter and every historical line naming it still reads correctly

#### Scenario: Another outlet's menu
- **WHEN** a Franchise Admin hand-crafts a menu write for an outlet they do not manage
- **THEN** the database refuses it

### Requirement: The live counter prefers the latest reachable menu

While the backend is reachable, the tablet SHALL fetch the latest menu for its
outlet and SHALL NOT silently prefer a cached version. During a live shift, an
actual backend failure MAY fall back to that shift's last successful snapshot and
SHALL display an offline banner.

#### Scenario: A price changes while the counter is online
- **WHEN** the counter refreshes after an authorised price change and the backend responds
- **THEN** newly added lines use the latest price while captured order and bill lines keep their snapshots

#### Scenario: The backend drops during a live shift
- **WHEN** the menu loaded successfully and a later refresh receives no backend response
- **THEN** the counter may continue from that shift's snapshot, marks the screen offline, and snapshots the displayed name and price into each new line

#### Scenario: The app starts with no reachable backend
- **WHEN** the tablet reloads or starts and cannot reach the backend for approval or a fresh menu
- **THEN** V1 opens no new billing work from a persisted cache, and shows unsent-work status instead
