## ADDED Requirements

### Requirement: Order and command tables are isolated at the database boundary

Orders SHALL carry `outlet_id`; order items/events/command receipts SHALL derive
scope through their parent. Every new table SHALL have RLS and an explicit
catalog-driven isolation case. Knowing a UUID SHALL not widen a caller's scope.

#### Scenario: Device names another outlet order
- **WHEN** a machine session hand-crafts a command or read for another outlet's order UUID
- **THEN** no row is returned and no mutation occurs

#### Scenario: New child table lacks an isolation case
- **WHEN** the catalog enumerates a billing child table not classified/tested
- **THEN** the isolation suite fails naming it

### Requirement: Money mutations use authorized commands, never table privilege

Machine and personal client roles SHALL have no direct insert/update/delete
privilege on orders, order items/events, command receipts, bills, or bill items.
Command functions SHALL re-derive outlet/device/grant or FA/SA recovery authority.

#### Scenario: Payload claims another outlet
- **WHEN** a valid device submits a command whose payload outlet differs from its device/grant
- **THEN** the command is refused regardless of the request body
