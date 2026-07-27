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
