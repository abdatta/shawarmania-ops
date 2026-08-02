## ADDED Requirements

### Requirement: Global customer identity is a classified exception, not outlet data

The tenancy catalog SHALL classify the customer profile table as global and
SHALL verify that it has no outlet-role direct read/write grant. The exception
SHALL cover identity/profile facts only; every customer-linked transaction SHALL
remain outlet- or child-scoped and covered by the isolation suite.

#### Scenario: Catalog discovers the global customer table
- **WHEN** the isolation suite enumerates public tables
- **THEN** customers is classified as global with explicit access tests, while orders, bills, and payments remain isolation cases

#### Scenario: Global identity is used to probe another outlet
- **WHEN** an outlet caller knows a customer UUID and names it in a transaction query
- **THEN** the database does not return another outlet's transaction or reveal that it exists
