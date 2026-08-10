## MODIFIED Requirements

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
