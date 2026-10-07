## ADDED Requirements

### Requirement: Managers deliberately order items within a category

An authorised manager SHALL move an active item up or down within its existing category. Each move SHALL persist the entire order atomically and SHALL work when existing sort positions tie. First and last items SHALL have their impossible directions disabled. It SHALL NOT change category membership, price, availability or captured bill lines.

#### Scenario: A dish belongs higher in its category
- **WHEN** a manager moves a dish up
- **THEN** it exchanges visible position with its preceding neighbour, and the counter and public reader use the saved order

#### Scenario: Stale membership
- **WHEN** another writer changes the category's active membership before a reorder saves
- **THEN** no partial order is saved and the manager is told to refresh

### Requirement: Each outlet has an editable named highlights selection

An authorised manager SHALL configure one title and ordered selection of distinct active dishes at their own outlet. The default title SHALL be Highlights; the title SHALL be nonblank after trimming and at most sixty characters. Selection SHALL leave dishes in their original categories. Save highlights SHALL commit title and selection together; closing without saving SHALL discard draft changes. A title, including Discounted Offers, SHALL NOT itself apply a discount. A different outlet's configuration SHALL be refused at the database boundary. Unavailable dishes SHALL retain their selection; removed dishes and inactive categories SHALL be filtered from it.

#### Scenario: Seasonal recommendations
- **WHEN** a manager names the section Recommended and selects dishes from several categories
- **THEN** those dishes appear in that order in the top section and remain in their categories with the same price and availability

#### Scenario: A promotion ends
- **WHEN** the last highlighted dish is unselected
- **THEN** the manager can configure it again and the customer sees no empty section

#### Scenario: The card always explains its purpose
- **WHEN** the manager views an empty or populated highlights card
- **THEN** its title and permanent subtitle “Highlight dishes at the top of your menu.” sit beside Edit, with selected dishes below only when present
- **AND** there is no separate customer preview action; the existing Share action remains available

#### Scenario: The editor leaves room for dish choices
- **WHEN** the manager opens Edit highlights
- **THEN** Section name and its input share a row, followed by full selected names with move/remove controls on their rows and “Search dishes or categories” above grouped choices
- **AND** there is no visible Selected dishes heading/count, introductory explanation, title examples, ordering guidance or repeated prices in selected rows
- **AND** the choices retain price, dietary and availability information and search has an accessible Choose dishes label
- **AND** an empty draft shows one normal-weight line, “No dishes highlighted yet.”, above search
- **AND** with two selected dishes on the reviewed phone viewport, search begins within 300 px of the dialog top

#### Scenario: A highlighted dish is recognised in its original category
- **WHEN** a dish belongs to the outlet's saved highlight selection
- **THEN** its regular category row shows the same sparkle symbol as the highlights heading, with an accessible Highlighted label
- **AND** its entry inside the highlights section does not repeat this symbol
- **AND** removing the dish from highlights removes its category-row symbol

#### Scenario: Availability has a compact marker
- **WHEN** a dish is unavailable
- **THEN** its regular category row shows a compact crossed-circle symbol with an accessible Unavailable label instead of a text badge
- **AND** the symbol can appear alongside the highlight symbol, and disappears when the dish becomes available
- **AND** only item details are muted; the action trigger and dropdown remain fully opaque

#### Scenario: Unused merchandising controls leave room for the menu
- **WHEN** the manager views a menu with no running discounts and no highlighted dishes on a 390×844 phone
- **THEN** discounts appear above a single compact highlights row at most 72 px high, and the first ordinary category starts in the upper half of the viewport
- **AND** Edit and the existing Share action remain available
- **AND** Menu Discounts shows concise category/whole-menu guidance below its title beside Add Discount, without moving the button to another row

#### Scenario: Outlet isolation
- **WHEN** an outlet manager crafts a read or write for another outlet's highlights
- **THEN** the data layer returns no other outlet's data and accepts no write there

## RENAMED Requirements

- FROM: `### Requirement: The outlet's counter discount presets are configured with the menu`
- TO: `### Requirement: The outlet's counter discount presets are configured in outlet settings`

## MODIFIED Requirements

### Requirement: The menu is a real record a manager creates and maintains in the app

The manager's item row SHALL carry its actions in one menu at the right with the price immediately left of it. It SHALL identify an unavailable item beside its name using an accessible Unavailable symbol and mute only its item details. The action trigger and dropdown SHALL remain fully opaque and operable. All other existing CRUD, removal, category creation and authority requirements and scenarios remain unchanged.

### Requirement: An outlet's menu discounts are set over categories, several at a time

The menu surface SHALL offer a **Menu Discounts** section with **Add Discount** to roles that may edit the menu. Its subtitle SHALL read “Category or whole-menu discounts.” below the title beside the action, without moving the button to another row on phones. Controls configuring actual discounts SHALL use discount terminology rather than sale, offer or promotion. This naming rule SHALL NOT restrict the user-defined highlights title or make highlighting apply a discount.

Setting one SHALL take a basis — a percentage or an amount in rupees — a value, and a set of categories chosen through a multi-select carrying a select-all. An outlet MAY hold any number of active menu discounts at once, at different values over different category sets, added one at a time. Each SHALL be independently removable. A Biller SHALL NOT be able to set, change or remove a menu discount, and the database SHALL refuse it. Category-row discount presentation is outside this change.

#### Scenario: Two discounts at different values
- **WHEN** a manager sets one discount over two categories and then sets another at a different value over two others
- **THEN** both are active, each over its own categories, and each is separately removable

#### Scenario: Every category at once
- **WHEN** a manager uses select-all
- **THEN** the discount covers every category in that outlet's menu

#### Scenario: A Biller attempts to set one
- **WHEN** a Biller hand-crafts a menu discount write
- **THEN** the database refuses it

#### Scenario: Another outlet's menu
- **WHEN** a Franchise Admin hand-crafts a menu discount write for an outlet they do not manage
- **THEN** the database refuses it

### Requirement: The outlet's counter discount presets are configured in outlet settings

The outlet settings page SHALL let the owner and that outlet's assigned manager configure the percentage and rupee amount presets the counter's discount panel offers, in a Bill discount shortcuts tile within the existing Orders section. Menu SHALL contain no counter preset controls. Editing SHALL use inline nested setting tiles and the same Save/Cancel and saved-feedback pattern as Orders and Loyalty: Save commits the full ordered configuration together, and Cancel discards the draft. A refused save SHALL keep the draft and error visible.

An outlet SHALL hold between none and four presets, ordered, defaulting to ten, fifteen and twenty percent. The upper bound SHALL be four, so the counter's preset row never wraps. A different outlet SHALL keep its independent configuration and existing database authority SHALL apply.

#### Scenario: The presets are reduced
- **WHEN** a manager removes a preset and saves in their outlet's settings
- **THEN** the counter panel offers the remaining ones on one row

#### Scenario: A fifth preset
- **WHEN** a manager attempts to configure a fifth preset
- **THEN** it is refused

#### Scenario: Shortcuts use a compact settings tile
- **WHEN** the outlet settings show the default three shortcuts
- **THEN** their controls sit side by side, the value, unit and Add controls share one row, and the whole tile is at most 180 px high on phone and tablet
- **AND** touch controls remain at least 44 px high, with accessible action labels and no horizontal overflow

#### Scenario: One through four shortcuts fill a row
- **WHEN** between one and four shortcuts are configured
- **THEN** they occupy one equal-width row filling the available tile width, including on phones
- **AND** each value and remove symbol belong to one labelled button retaining its full accessible value and title
- **AND** the addition row is absent at four, while an empty configuration reads “No shortcuts set.”

#### Scenario: Order settings and shortcuts both have changes
- **WHEN** both order settings and bill discount shortcuts have unsaved changes
- **THEN** each has its own sibling card and Save/Cancel actions labelled simply Save and Cancel; the order settings actions appear above the shortcut card, and the shortcut actions belong only to shortcuts
- **AND** saving or cancelling either leaves the other draft and saved configuration unchanged

#### Scenario: A shortcut save succeeds
- **WHEN** the shortcut configuration is saved successfully
- **THEN** its own outer card uses the same saved glow and Saved confirmation timing as Orders and Loyalty
- **AND** a draft, cancellation or failed save does not trigger the glow, and reduced-motion preferences suppress its animation

#### Scenario: An edit is cancelled
- **WHEN** a manager changes a draft and chooses Cancel
- **THEN** the outlet and counter retain their saved presets and any unfinished addition is cleared

#### Scenario: Only the current active outlet is editable
- **WHEN** the setting is read-only, its outlet is not visible and active, or the displayed outlet changes
- **THEN** read-only readers have no editing controls, the setting does not mount for an unavailable outlet, and no draft from the previous outlet survives a switch
