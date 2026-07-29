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

Every figure the owner console, comparison, report and profit surfaces show
SHALL be derived from recorded bills, expenses, inventory movements and cash
records. No figure SHALL be supplied to the data layer by the caller, and no
figure SHALL be stored as a total that its own rows do not produce.

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

### Requirement: Two outlets are compared over a chosen period

The comparison surface SHALL show the selected outlets side by side over a
chosen period, with sales, expenses, estimated profit and cash differences for
each, and SHALL state the period and the profit basis on screen.

#### Scenario: Comparing over a period

- **WHEN** the Super Admin chooses a period on the comparison surface
- **THEN** each outlet's sales, expenses, estimated profit and cash difference for that period are shown side by side, with the period stated

### Requirement: Reports summarise a period on screen and produce no file

The reports surface SHALL show a period summary — sales by payment method,
expenses by category, estimated profit on the stated basis, and cash
differences by day — for the selected outlet or outlets.

While the figures are demonstration data, the surface SHALL NOT produce a
downloadable or shareable file of them, and SHALL state on screen that
exporting arrives when the figures are real.

#### Scenario: A period summary

- **WHEN** a period is chosen on the reports surface
- **THEN** sales by payment method, expenses by category, estimated profit and cash differences by day are shown for that period

#### Scenario: No file of fabricated figures

- **WHEN** the reports surface is rendered against demonstration data
- **THEN** no export file can be produced from it, and the surface states when exporting becomes available
