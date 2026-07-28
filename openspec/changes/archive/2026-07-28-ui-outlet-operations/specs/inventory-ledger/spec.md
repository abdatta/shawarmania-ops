# Inventory Ledger

## ADDED Requirements

### Requirement: The inventory surface shows every item with its current quantity and unit

The inventory surface SHALL list an outlet's active stock items with the
current quantity and unit for each. The quantity shown SHALL equal the sum of
that item's movement deltas, so the list and the ledger can never disagree.

#### Scenario: Reading the stock list

- **WHEN** a Franchise Admin opens the inventory surface
- **THEN** every active item appears with its current quantity and unit

#### Scenario: The list agrees with the ledger

- **WHEN** any item's listed quantity is compared with the sum of its movements' deltas
- **THEN** they are equal

### Requirement: Low stock is signalled by an icon and a word, never by colour alone

An item whose current quantity is at or below its low-stock threshold SHALL be
marked low, using an icon and a text label in addition to any colour.

#### Scenario: An item at its threshold

- **WHEN** an item's current quantity equals its low-stock threshold
- **THEN** the item is marked low

#### Scenario: The low-stock treatment

- **WHEN** an item is marked low
- **THEN** the treatment includes an icon and a text label, so the state is legible without colour

### Requirement: Recording a movement is the primary action and carries its own sign

Recording a stock movement SHALL be available from the item without leaving
the inventory surface, and SHALL accept a movement type of added, used, wasted
or correction, a quantity, and an optional note. The stored delta's sign SHALL
be derived from the movement type — added increases stock, used and wasted
decrease it — so a person recording stock never enters a negative number for
an ordinary movement.

#### Scenario: Recording stock used

- **WHEN** a Franchise Admin records a used movement of a quantity for an item
- **THEN** the item's current quantity decreases by exactly that quantity

#### Scenario: Recording stock added

- **WHEN** a Franchise Admin records an added movement of a quantity for an item
- **THEN** the item's current quantity increases by exactly that quantity

### Requirement: Every item opens to its own movement ledger

Each stock item SHALL have a ledger view listing its movements most recent
first, each showing the type, the signed quantity, the note, the business date
and the resulting quantity after that movement. The ledger SHALL be reachable
by its own address so it can be linked to.

#### Scenario: Asking why a quantity is what it is

- **WHEN** a Franchise Admin opens an item's ledger
- **THEN** every movement is listed most recent first with its type, signed quantity, note, business date, and the quantity after it

### Requirement: History is corrected, never edited

The ledger SHALL offer no way to edit or delete a recorded movement. A
mistaken entry SHALL be corrected by recording a correction movement with a
note, and both rows SHALL remain visible.

#### Scenario: Correcting a mistake from the surface

- **WHEN** a Franchise Admin corrects a mistaken entry
- **THEN** a correction movement with a note is added, the original movement is still listed, and the quantity reflects their sum

#### Scenario: No edit affordance exists

- **WHEN** the ledger is rendered
- **THEN** no control is offered that would modify or remove an existing movement

### Requirement: Quantities are rounded to a fixed precision at every boundary

Stock quantities SHALL be rounded to three decimal places wherever they are
summed or displayed, so that repeated fractional movements cannot accumulate
binary floating-point error into a figure a person is asked to trust.

#### Scenario: Repeated fractional movements

- **WHEN** movements of 0.1 and 0.2 of a unit are added to an item with no stock
- **THEN** the item's current quantity is exactly 0.3
