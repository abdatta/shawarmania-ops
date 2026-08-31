## REMOVED Requirements

### Requirement: The movements ledger is the source of truth and is append-only

**Reason**: Inventory was already formally shelved on the roadmap
(`openspec/todos/inventory-is-shelved.md`): nothing was to make it real until the
business asked, and the business has not. The demonstration surface outlived that
decision and is now removed with it (owner decision, 2026-08-31).

`inventory_movements` and its derived-quantity trigger keep their policies and
their isolation coverage. The screens go; the schema stays, so if stock ever
becomes real the ledger model this capability described is still on disk.

### Requirement: Current stock is a derived cache that always equals the ledger

**Reason**: Withdrawn with the capability above.

### Requirement: The inventory surface shows every item with its current quantity and unit

**Reason**: Withdrawn with the capability above.

### Requirement: Low stock is signalled by an icon and a word, never by colour alone

**Reason**: Withdrawn with the capability above.

### Requirement: Recording a movement is the primary action and carries its own sign

**Reason**: Withdrawn with the capability above.

### Requirement: Every item opens to its own movement ledger

**Reason**: Withdrawn with the capability above.

### Requirement: History is corrected, never edited

**Reason**: Withdrawn with the capability above.

### Requirement: Quantities are rounded to a fixed precision at every boundary

**Reason**: Withdrawn with the capability above.

### Requirement: The owner records a stock correction at any outlet, and only a correction

**Reason**: Withdrawn with the capability above.
