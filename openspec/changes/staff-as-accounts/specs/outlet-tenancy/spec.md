# outlet-tenancy — delta for staff-as-accounts

## MODIFIED Requirements

### Requirement: An Employee reads only their own records

An Employee session SHALL read only their own attendance rows — the rows
keyed to their own account — and none of any colleague, in either outlet.

#### Scenario: Employee lists attendance

- **WHEN** an Employee lists attendance rows
- **THEN** only rows keyed to their own account are returned

#### Scenario: Employee requests a colleague's rows

- **WHEN** an Employee issues a request explicitly naming a colleague's
  account id
- **THEN** zero rows are returned
