# Profit Estimates

## ADDED Requirements

### Requirement: Profit is reported on one of two named bases, and the basis is always stated

Any surface showing an estimated profit SHALL compute it on exactly one of two
bases and SHALL state which one on screen, in words, beside the figure:

- **Cash basis** — sales minus all expenses.
- **Consumption basis** — sales minus non-raw-material expenses minus
  inventory consumed, valued at purchase cost.

A profit figure SHALL NOT be shown without its basis, and the two bases SHALL
NOT be combined into a single figure.

#### Scenario: The basis is on screen

- **WHEN** a profit figure is rendered on any surface
- **THEN** the basis it was computed on is stated in words beside it

#### Scenario: Switching basis

- **WHEN** the reader switches the basis
- **THEN** the figure is recomputed on the other basis and the stated basis changes with it

### Requirement: Raw materials are counted once, never twice

Consumption-basis profit SHALL exclude expenses categorised as raw materials
and SHALL instead count inventory consumed, so that food bought and food used
are never both subtracted from the same period's sales.

Inventory consumed SHALL count `used` and `wasted` movements only. An `added`
movement SHALL NOT be counted as consumption, and a `correction` SHALL NOT be
counted as consumption, because it records a counting fix rather than food
leaving the kitchen.

#### Scenario: A period containing both a purchase and its consumption

- **WHEN** a period contains a raw-material expense and the used movements it paid for
- **THEN** consumption-basis profit subtracts the consumed stock and not the raw-material expense, so the food is counted exactly once

#### Scenario: A correction is not consumption

- **WHEN** a period contains a correction movement reducing an item's quantity
- **THEN** consumption-basis profit does not treat that reduction as stock consumed

### Requirement: Profit arithmetic is integer paise and rejects anything else

Every profit computation SHALL operate on integer paise and SHALL reject a
non-integer input rather than rounding it, in the same way the rest of the
money path does.

#### Scenario: A non-integer amount

- **WHEN** a profit computation receives a non-integer paise amount
- **THEN** it throws rather than producing a figure
