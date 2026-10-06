## RENAMED Requirements

- FROM: `### Requirement: The whole menu is visible at once on a counter tablet`
- TO: `### Requirement: The menu is searchable at the counter, and every available item is reachable`

## MODIFIED Requirements

### Requirement: The menu is searchable at the counter, and every available item is reachable

The billing surface SHALL present every menu item for the outlet in one
scrolling column on a counter tablet, under a search field that stays visible
while the column scrolls. An unavailable item SHALL NOT be sellable from the
grid.

Typing in the search field SHALL narrow the grid, in the browser and without a
request, to the items whose name or category name contains every
whitespace-separated word typed, ignoring case and order. A category with no
matching item SHALL be hidden. A matching unavailable item SHALL remain shown
and unsellable. When nothing matches, the column SHALL say so.

The search SHALL persist when an item is added from the grid. It SHALL be
cleared only by its clear control or by the Escape key, and clearing SHALL
remove focus from the field. Escape SHALL NOT clear the search while a dialog
or a menu is open, nor while focus is in another text field.

#### Scenario: Searching narrows the grid

- **WHEN** a biller types "chee chi" into the menu search
- **THEN** only items whose name or category contains both "chee" and "chi" are shown, and categories left empty are hidden

#### Scenario: A search by category

- **WHEN** a biller types a category's name
- **THEN** every item in that category is shown

#### Scenario: The search outlives a tap

- **WHEN** a biller adds an item from a filtered grid
- **THEN** the item is on the bill and the search and its results are unchanged

#### Scenario: Clearing the search

- **WHEN** a biller presses the search's clear control, or presses Escape with no dialog or menu open
- **THEN** the search is empty, the whole menu is shown, and the search field does not have focus

#### Scenario: Escape belongs to an open dialog

- **WHEN** a dialog is open over a counter with a search typed and the biller presses Escape
- **THEN** the dialog closes and the search is unchanged

#### Scenario: Nothing matches

- **WHEN** the search matches no item
- **THEN** the column says that no item matches what was typed

#### Scenario: An unavailable item

- **WHEN** the menu contains an item marked unavailable
- **THEN** that item cannot be added to the current bill, whether or not a search is shown
