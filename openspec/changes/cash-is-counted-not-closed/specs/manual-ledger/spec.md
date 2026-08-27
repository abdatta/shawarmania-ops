## MODIFIED Requirements

### Requirement: The manual ledger is a record only, and its rows outlive its surface

The manual ledger SHALL be a record only. It SHALL NOT read, write or influence
any live attendance, billing, expense, cash or reporting row, and no live surface
SHALL read from its tables.

**The precedent clause is discharged, not inherited.** This capability's reach
was never precedent for the live drawer, and the live drawer's boundary has now
been decided on its own merits by `cash-drawer` and `identity-and-access`: a
Super Admin reaches every outlet's drawer, and what that costs is that the record
carries where they stood. That an outlet staff role may record a drawer expense
in this notebook remains no precedent for the live expense record, whose grants
are `outlet-expenses`' own to decide.

The capability SHALL be removed only by a change that first carries its rows into
the live cash and expense records, so that a period recorded here remains
readable from the real reports afterwards. That carry-over SHALL preserve, for
every row, the account that recorded it, the account that last corrected it,
whether it was voided and by whom and why, and whether it was recorded from away.
Dropping the tables without that carry-over SHALL NOT satisfy the removal.
**That removal belongs to `retire-the-manual-ledger` (#12) and is not performed
here.**

#### Scenario: No live figure moves

- **WHEN** a manual-ledger day or expense row is written, corrected or voided
- **THEN** no attendance, bill, live expense, drawer observation or live report figure changes

#### Scenario: No live surface reads the notebook

- **WHEN** the cash drawer or the derived ledger statement is rendered
- **THEN** neither queries a manual-ledger table

#### Scenario: Retirement carries the attribution, not only the amounts

- **WHEN** the change that removes this capability runs
- **THEN** every recorded day and expense row is carried into the live records with its recording account, correcting account, void state and reason, and recorded-from-away marker intact, and the removal is incomplete until it is

## ADDED Requirements

### Requirement: The manual ledger leaves the navigation while remaining reachable

While the derived ledger statement is being proved, the manual ledger SHALL
remain a live surface at its own route and SHALL be removed from the primary
navigation, so that the derived statement is the one a reader lands on and the
manual form remains available for comparison and as the fallback.

The fallback SHALL be the surface itself rather than a switch: no runtime
toggle, environment flag or stored setting SHALL select between the two
readings, and the gate registry SHALL remain a build-time constant.

Both surfaces SHALL be readable at the same time, so a reader may open one
business date in each and compare them.

#### Scenario: The reader lands on the derived statement

- **WHEN** a Super Admin or an assigned Franchise Admin opens the ledger from the navigation
- **THEN** the derived statement is shown, and the manual form keeps a navigation
  entry of its own under a different name so both can be open at once

#### Scenario: The fallback is reachable without remembering a route

- **WHEN** the navigation is inspected during the overlap
- **THEN** it offers both readings as separate entries, because a fallback that
  needs a typed URL is not one

#### Scenario: The manual form is still reachable

- **WHEN** the manual ledger's route is opened directly
- **THEN** it renders in full, with its rows and its entry fields unchanged

#### Scenario: No runtime switch exists

- **WHEN** the application is inspected for a control selecting between the two ledgers
- **THEN** none exists in configuration, storage or the interface
