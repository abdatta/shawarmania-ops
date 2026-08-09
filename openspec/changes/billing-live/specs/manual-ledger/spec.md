## MODIFIED Requirements

### Requirement: A live outlet's counter revenue comes from bills, and the ledger says so

From the business date an outlet's billing goes live, the manual ledger SHALL
source that outlet's counter revenue from paid bills rather than from a typed
figure, SHALL state on screen that the figure came from the counter, and SHALL
NOT offer a second field inviting the same money to be entered again.

Every other part of the ledger SHALL keep working by hand until #12 and #13
retire it: aggregator commission, cash in and out, expenses, and the counted
drawer. A business date before that outlet went live SHALL keep its typed figure
exactly as recorded.

#### Scenario: The night an outlet goes live
- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** counter revenue is shown as coming from the counter, is not editable there, and the remaining fields are entered as before

#### Scenario: An earlier month is reopened
- **WHEN** the owner opens a business date from before that outlet went live
- **THEN** the typed revenue figure is unchanged and still editable

#### Scenario: The other outlet is not live yet
- **WHEN** one outlet is live and the other is not
- **THEN** the live outlet's revenue comes from bills and the other outlet's is still entered by hand, each labelled for what it is

#### Scenario: The same money cannot be counted twice
- **WHEN** a live outlet's day is read in the month view
- **THEN** counter revenue appears exactly once, whatever was previously typed for that outlet on that date
