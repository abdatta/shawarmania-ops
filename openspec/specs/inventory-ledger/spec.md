# Inventory Ledger

## Purpose

Makes stock auditable: the movements ledger is the truth, the current-quantity figure is a cache the database maintains from it, and history cannot be edited — only corrected by new entries. "Why does the system think we have 4 kg?" is always answerable by reading the ledger.

## Requirements

### Requirement: The movements ledger is the source of truth and is append-only

Every stock change SHALL be recorded as a movement row with a signed quantity
delta. Movements SHALL be immutable once written: updates and deletes MUST be
rejected for every client role. A correction SHALL be a new correction
movement with a note, never an edit of history.

#### Scenario: Editing a movement

- **WHEN** any session attempts to update or delete an existing movement row
- **THEN** the database rejects the operation

#### Scenario: Correcting a mistaken entry

- **WHEN** a Franchise Admin records a correction movement with a note
- **THEN** the ledger contains both the original movement and the correction, and the stock level reflects their sum

### Requirement: Current stock is a derived cache that always equals the ledger

Each inventory item's current quantity SHALL be maintained by the database
from its movements, such that it always equals the sum of the item's quantity
deltas. Clients MUST NOT be able to write the current quantity directly.

#### Scenario: A movement lands

- **WHEN** a movement with a quantity delta is inserted for an item
- **THEN** the item's current quantity changes by exactly that delta

#### Scenario: A client writes the cache directly

- **WHEN** a session attempts to update an item's current quantity column directly
- **THEN** the database rejects the write

#### Scenario: Cache equals ledger

- **WHEN** the current quantity of any item is compared with the sum of its movements' deltas
- **THEN** they are equal

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

### Requirement: The owner records a stock correction at any outlet, and only a correction

The Super Admin SHALL be able to append an inventory correction at any outlet
without holding an assignment there, carrying the mandatory note every
correction already carries. The movement SHALL be attributed to the owner and
SHALL be shown as the owner's entry wherever the ledger is read.

Movements of every other kind — added, used, wasted — SHALL remain the work of
a person assigned to that outlet, because counting stock in and out is done
standing in the shop. The database SHALL refuse the others from this path.

A Super Admin who holds a Franchise Admin assignment at the outlet SHALL be
able to record any movement there, because that authority comes from the
assignment.

#### Scenario: The owner corrects a count remotely

- **WHEN** a Super Admin appends a correction with a note at an outlet they
  hold no assignment at
- **THEN** the movement is stored, the item's current quantity moves by exactly
  that delta, and the ledger row reads as the owner's entry

#### Scenario: A remote stock receipt is refused

- **WHEN** a Super Admin holding no assignment at an outlet attempts to append
  an `added`, `used` or `wasted` movement there, including by a hand-crafted
  request
- **THEN** the database refuses the write and the item's quantity is unchanged

#### Scenario: The ledger still reconciles after an owner correction

- **WHEN** an item's movements include an owner-recorded correction
- **THEN** the item's current quantity equals the sum of every movement delta,
  exactly as for any other movement
