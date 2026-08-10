# Menu Management

## Purpose

What an outlet sells and for how much, and who may change it. Two frequent actions shape the whole capability: availability is flipped mid-service by whoever is standing in the kitchen, and a price change is rare, deliberate, and **never retroactive** — bills snapshot what they charged, so the menu can move without rewriting what has already been sold. A Biller reads it from the counter's own menu column rather than from a surface of their own; the database is what stops them writing it.

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

A Biller SHALL be able to read their outlet's menu — every item, its price, its
vegetarian marker and whether it is currently sellable — **from the counter
itself**, without navigating away from the bill they are composing. There SHALL
NOT be a separate read-only menu surface in the Biller's shell: the counter's menu
column carries those facts permanently, and a second page carrying the same facts
is a second place to look.

Every menu write SHALL be refused for a Biller by the data layer rather than by the
absence of a control or of a surface. An unavailable item SHALL remain visible to
the Biller, marked as off and **without its price**, since a price nobody can sell
is one a biller might quote before noticing.

#### Scenario: A Biller checks what is available and what it costs
- **WHEN** a Biller needs to know whether an item is on and what it charges
- **THEN** the counter's own menu column answers both without leaving the till, and no Menu entry exists in that shell

#### Scenario: A Biller attempts a menu write
- **WHEN** a Biller session attempts to create, edit, or change the availability of a menu item
- **THEN** the write is refused by the data layer, unchanged by the read-only surface having been retired

#### Scenario: An item the kitchen has run out of
- **WHEN** an item is marked unavailable
- **THEN** the Biller still sees it, marked off, carrying no price, and cannot add it to a bill
### Requirement: Menu prices are integer paise

Menu item prices SHALL be held and passed as integer paise, converted from
rupees only at the input boundary and to rupees only at the display edge.

#### Scenario: A price typed in rupees

- **WHEN** a Franchise Admin enters a price in rupees and saves it
- **THEN** the value passed to the data layer is integer paise
