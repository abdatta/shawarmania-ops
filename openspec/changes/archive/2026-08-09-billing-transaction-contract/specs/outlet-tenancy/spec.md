## ADDED Requirements

### Requirement: Order and command tables are isolated at the database boundary

Orders SHALL carry `outlet_id`, and order items, command receipts and end-of-day
confirmations SHALL derive scope through their parent or their own outlet column.
Every new table SHALL have a Row-Level Security policy and an explicit
catalog-driven isolation case. Knowing a UUID SHALL NOT widen a caller's scope.

#### Scenario: A tablet names another outlet's order
- **WHEN** a device session hand-crafts a command or read for another outlet's order UUID
- **THEN** no row is returned and no mutation occurs

#### Scenario: A new child table has no isolation case
- **WHEN** the catalog enumerates a billing child table that is not classified and tested
- **THEN** the isolation suite fails, naming it

### Requirement: Money mutations use authorised commands, never table privilege

Device sessions and personal client roles SHALL hold no direct insert, update or
delete privilege on orders, order items, command receipts, bills or bill items.
Command functions SHALL re-derive outlet, tablet and shift, or the manager
authority behind a cancellation or a void, from the database.

#### Scenario: Payload claims another outlet
- **WHEN** a valid tablet submits a command whose payload outlet differs from its own tablet and shift
- **THEN** the command is refused whatever the request body says
