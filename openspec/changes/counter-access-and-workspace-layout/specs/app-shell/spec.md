## MODIFIED Requirements

### Requirement: Billing lifecycle surfaces are gated by context and readiness

The registry SHALL define the Counter composer, Open orders, My shift and manager
bill history as gated surfaces. The Counter surface SHALL combine the composer,
this tablet's open orders and this shift's bills into one three-column workspace
**at every width**, and Open orders and My shift SHALL therefore carry no
navigation entry of their own: a tab leading to a second copy of a column already
on screen is a second door into one room. Their routes and standalone layouts
SHALL remain, because the gate still decides whether the content renders and a
link into either one still has to resolve. Tablet routes SHALL expose only
Counter-context entries; personal FA and SA shells SHALL expose their authorised
history entries. Until billing goes live, every new entry SHALL be absent for
real users and walkable in demo mode.

The menu column SHALL remain at least 22rem wide. The current-bill and activity
columns SHALL each start at 22rem and offer independent, named resize controls.
Dragging or using the controls' keyboard interaction SHALL resize only the named
column, never fold, reorder, or hide a column. The selected widths SHALL be
remembered by the counter browser and invalid or unavailable stored preferences
SHALL fall back to the 22rem default. When the three minimum columns or a chosen
width do not fit, the workspace — and only the workspace — SHALL scroll
horizontally.

#### Scenario: Demo Counter navigation
- **WHEN** demo mode renders the Counter shell after this change
- **THEN** the composer, Shift, Menu and Expenses are reachable, Open orders and My shift appear as columns rather than as tabs, and no personal admin navigation appears

#### Scenario: Counter workspace at any width
- **WHEN** demo mode renders the Counter at a landscape-tablet width or narrower
- **THEN** the menu, current bill, open orders and this shift's bills are all present as three touch-safe columns, without changing routes and without any of them folding away

#### Scenario: A counter user resizes an activity column
- **WHEN** a user drags or uses the named resize control for the current-bill or activity column
- **THEN** that column changes width, the menu remains at least 22rem wide, and all three columns remain in their original order

#### Scenario: A counter reloads with a saved layout
- **WHEN** a counter browser reloads after either resizable column was adjusted
- **THEN** the workspace restores the valid saved widths, or both columns use the 22rem default when no valid preference is available

The Counter shell SHALL NOT carry a read-only Menu surface. The Counter's own menu
column shows every item, its price, its veg marker and an Off marker on anything
unavailable, permanently and beside the bill, so a second page carrying the same
facts is a second place to look. The refusal of a Biller's menu write SHALL remain
the menu policies', unchanged by the surface's absence.

#### Scenario: A biller asks whether an item is still on
- **WHEN** a biller needs to know what is available and what it costs
- **THEN** the Counter's menu column answers it without leaving the till, and no separate Menu entry exists in the Counter shell

#### Scenario: A biller's menu write
- **WHEN** a Biller session attempts a menu write directly against the data layer
- **THEN** it is refused by policy exactly as it was while the read-only screen existed

#### Scenario: Real user before promotion
- **WHEN** a real signed-in user loads the application before billing goes live
- **THEN** the new billing entries remain absent rather than disabled
