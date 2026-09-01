# Cross-Outlet Oversight

## Purpose

Guarantees that the owner can read every outlet's position from one screen and compare them over a period: figures derived from recorded bills, expenses, movements and cash records rather than supplied, closed days reported from their snapshots, an outlet switcher that can never widen past what the caller may read, and — while the figures are demonstration data — no way to export a file of them.

## Requirements

### Requirement: The owner console shows every outlet side by side

The owner console SHALL show one entry per outlet the caller may see, each
carrying that outlet's figures for the current business day: sales split by
payment method, cash position, open alerts, and anything needing attention.
Outlets SHALL be shown together on one screen rather than reached one at a
time.

An outlet whose figures are not available SHALL still be shown, with the
absence stated, and SHALL NOT be omitted from the list.

#### Scenario: Two trading outlets

- **WHEN** the Super Admin opens the owner console and both outlets have traded today
- **THEN** both outlets appear on one screen, each with today's sales, its cash position, and its open alert count

#### Scenario: An outlet with no figures available

- **WHEN** the console renders an outlet for which no figures can be resolved
- **THEN** the outlet is still listed, and the screen states that its figures are unavailable rather than showing a zero

### Requirement: Every console figure is derived from recorded rows

Every figure SHALL be derived from recorded rows: what the owner console,
comparison, report and profit surfaces show comes from recorded bills,
expenses, inventory movements and cash records. No figure SHALL be supplied
to the data layer by the caller, and no figure SHALL be stored as a total
that its own rows do not produce.

A business day that has been closed SHALL contribute the figures snapshotted
at close, never a recomputation of them.

#### Scenario: Sales agree with the bills behind them

- **WHEN** the console shows an outlet's sales for a business day
- **THEN** the figure equals the sum of that outlet's settled bills for that business date

#### Scenario: A closed day is not recomputed

- **WHEN** a report includes a business day whose cash record has been closed
- **THEN** the closed figures are the ones reported, unchanged by anything that arrived afterwards

### Requirement: The outlet switcher scopes the console and never widens it

The owner console SHALL offer a control selecting all outlets or exactly one
of them, and that selection SHALL scope the console, the comparison and the
profit surfaces. The control SHALL offer only outlets the data layer returned
for the caller, and SHALL NOT offer an outlet the caller may not read.

#### Scenario: Scoping to one outlet

- **WHEN** the Super Admin selects a single outlet in the switcher
- **THEN** every figure on the console is for that outlet alone, and the selection is stated on screen

#### Scenario: The switcher offers no outlet the caller cannot read

- **WHEN** the switcher is rendered
- **THEN** it lists exactly the outlets the data layer returned, and no identifier the caller supplied can add one

### Requirement: An outlet opens to a read-only view of its day

Selecting an outlet from the console SHALL open a view of that outlet's day at
its own address, showing sales by payment method, the cash position and
whether the day is closed, low-stock items, open alerts, and who is checked
in. The view SHALL state that it is read-only, and SHALL NOT offer a control
that writes an operational record.

#### Scenario: The owner inspects one outlet

- **WHEN** the Super Admin opens an outlet from the console
- **THEN** that outlet's day is shown in depth, at an address that can be linked to, and the screen states that it is read-only

#### Scenario: A write is refused rather than hidden

- **WHEN** a write against another outlet's operational records is attempted from this view
- **THEN** the data layer refuses it, and the refusal does not depend on a control being absent
