## MODIFIED Requirements

### Requirement: A ledger day is derived on read and is never stored

The per-day ledger reading SHALL be computed on read from bills, expenses,
sourced aggregator channel days, drawer cash out and drawer observations. No
table SHALL store a per-outlet-per-day ledger row, and no figure on the reading
SHALL be writable.

A business date at which nothing was recorded SHALL still render in full.

**The reading SHALL cover every date the business has traded, from one set of
sources.** Dates before an outlet's counter was ringing bills SHALL be served by
carried legacy observations and carried expenses, not by a second reader and not
by a branch on when the notebook ended. After the carry-over there SHALL be no
date at which the ledger has to consult a retired table to be complete.

#### Scenario: A day nobody touched

- **WHEN** a business date with no observation, no expense and no aggregator figure is opened
- **THEN** the day renders completely, with its derived balances and zeroes rather than an empty state

#### Scenario: A date before the counter existed

- **WHEN** a business date preceding that outlet's first bill is opened
- **THEN** it renders from carried rows through the same reader, with its drawer figures marked legacy imprecise

#### Scenario: No retired table is read

- **WHEN** the derived reading is rendered for any date in the business's history
- **THEN** it queries no archived or retired table

#### Scenario: No stored row can disagree with its sources

- **WHEN** any figure contributing to a day changes
- **THEN** the day's reading reflects it on the next read, with no stored row to reconcile
