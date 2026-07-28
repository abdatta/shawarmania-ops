# Menu Management

## Purpose

What an outlet sells and for how much, and who may change it. Two frequent actions shape the whole capability: availability is flipped mid-service by whoever is standing in the kitchen, and a price change is rare, deliberate, and **never retroactive** — bills snapshot what they charged, so the menu can move without rewriting what has already been sold. A Biller reads this; the database is what stops them writing it.

## Requirements

### Requirement: The menu surface lists every category and item for one outlet

The menu surface SHALL show an outlet's menu categories in sort order, each
with its items in sort order, and SHALL show for every item its name, price,
availability, and whether it is vegetarian. An outlet with no menu SHALL show
an empty state saying what to create, never a blank region.

#### Scenario: An outlet with a menu

- **WHEN** a Franchise Admin opens the menu surface for an outlet that has categories and items
- **THEN** every category appears in sort order with its items beneath it, each showing name, price and availability

#### Scenario: An outlet with no menu yet

- **WHEN** the menu surface is opened for an outlet with no categories
- **THEN** an empty state states what to create first, and the create action is offered from it

### Requirement: Vegetarian status is conveyed by shape as well as colour

Every place the menu marks an item vegetarian or non-vegetarian SHALL convey
the distinction by shape and by an accessible text label, not by colour alone.

#### Scenario: A colour-blind reader

- **WHEN** any surface renders a menu item's vegetarian marker
- **THEN** the marker carries a distinct shape per value and a text label available to assistive technology, in addition to its colour

### Requirement: Availability is a distinct, thumb-reachable action

Changing an item's availability SHALL be a single action on the item's row,
separate from opening the item for editing, and the item's rendered state
SHALL change immediately to reflect it. An unavailable item SHALL remain
visible and SHALL be labelled unavailable rather than removed from the list.

#### Scenario: Marking an item unavailable

- **WHEN** a Franchise Admin toggles availability on an item that is available
- **THEN** the item is marked unavailable in place, and no editing form is opened

#### Scenario: An unavailable item stays on the list

- **WHEN** the menu surface renders an item that is not available
- **THEN** the item is present and labelled unavailable

### Requirement: A price change applies only to future bills

Editing an item's price SHALL state, before it is saved, that the new price
applies to future bills only. Bills already recorded SHALL be unaffected by
the change, because their line items store the name and unit price as charged.

#### Scenario: Editing a price

- **WHEN** a Franchise Admin changes an item's price
- **THEN** the surface states that the change applies to future bills only before the change is saved

#### Scenario: A recorded bill after a price change

- **WHEN** an item's price is changed after a bill containing that item was settled
- **THEN** that bill's stored line item name, unit price and totals are unchanged

### Requirement: A Biller may read the menu and may not change it

A Biller SHALL be able to view their outlet's menu. Every menu write SHALL be
refused for a Biller by the data layer rather than by the absence of a
control, and the surface SHALL state that the menu is a manager's to change.

#### Scenario: A Biller opens the menu

- **WHEN** a Biller opens the menu surface
- **THEN** the categories and items are shown, and the surface states that changes are made by a manager

#### Scenario: A Biller attempts a menu write

- **WHEN** a Biller session attempts to create, edit, or change the availability of a menu item
- **THEN** the write is refused by the data layer

### Requirement: Menu prices are integer paise

Menu item prices SHALL be held and passed as integer paise, converted from
rupees only at the input boundary and to rupees only at the display edge.

#### Scenario: A price typed in rupees

- **WHEN** a Franchise Admin enters a price in rupees and saves it
- **THEN** the value passed to the data layer is integer paise

