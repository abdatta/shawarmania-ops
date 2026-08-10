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

**A category SHALL NOT be a thing a manager creates on its own.** The unit of work
is the item; a category is the heading items are grouped under, entered as a
free-form field on the item that suggests the outlet's existing categories and
creates an unrecognised one on the way through — the pattern the expense list
already uses. The surface SHALL therefore offer one add action, and SHALL NOT be
able to leave an empty category behind. Because a near-miss silently fragments the
counter's grid, creating a category the outlet does not already have SHALL be
confirmed rather than assumed.

The manager's item row SHALL carry its actions in one menu at the right with the
price immediately left of it, SHALL mark an unavailable item beside its name, and
SHALL render that row in the same disabled treatment as a deleted expense row.

#### Scenario: The first item at a new outlet
- **WHEN** a manager adds an item and types a category the outlet has none of
- **THEN** they are asked to confirm the new category, and it exists with that item inside it — with no separate step that could have created it empty

#### Scenario: A near-miss on an existing category
- **WHEN** the typed category differs from an existing one only by a character or a plural
- **THEN** the existing category is offered before a new one is created, because two headings for one group split that group at the counter

#### Scenario: The last item leaves a category
- **WHEN** an item is retired and its category holds nothing else
- **THEN** no empty heading is left for a manager to tidy up

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
