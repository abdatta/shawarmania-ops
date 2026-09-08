## ADDED Requirements

### Requirement: A month link opens its named outlet and month

The Ledger SHALL accept a linked authorised outlet and valid non-future month and open its month view, overriding remembered scope for the visit without granting access. Invalid months SHALL fall back safely to the current month.

#### Scenario: Linked month reloads

- **WHEN** a manager follows or reloads a link to an assigned outlet's September month view
- **THEN** that outlet and September month view load rather than the default day view
