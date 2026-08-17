## ADDED Requirements

### Requirement: A synced day states gross, commission and net as three stored figures

For every outlet and business date the sync covers, the ledger SHALL store the aggregator's gross order value, the commission and fees deducted from it, and the net actually receivable, each as its own integer-paise value read from the aggregator rather than derived from a stored rate.

The net SHALL NOT be recomputed from gross and a percentage at read time. The effective rate moves between roughly 24% and 35% across days, so a single stored rate misstates every day it was not measured on, and rounding a measured rate back to basis points loses the paise on which reconciliation depends.

A day's effective rate MAY be presented, computed from the stored gross and net for display only.

#### Scenario: A day arrives with all three figures

- **WHEN** the sync writes an outlet's business date
- **THEN** gross, commission and net are each stored as integer paise, and net plus commission equals gross for that day

#### Scenario: The rate is a reading, not an input

- **WHEN** a synced day is read
- **THEN** any rate shown is computed from the stored gross and net, and no stored percentage participates in computing that day's net revenue

#### Scenario: A day recorded before the sync is untouched

- **WHEN** a business date recorded by hand before this capability existed is read
- **THEN** its net is still computed from its stored figure and its stored commission rate, and its stored values are byte-for-byte unchanged

### Requirement: An order belongs to the trading day its placement time falls in

Each order SHALL be attributed to the business date produced by applying the outlet's own `business_day_cutover` to the order's **placement timestamp**, through the same rule the rest of the application uses.

The aggregator dates orders by calendar midnight and the outlets cut over at 04:00, so an order placed at 00:30 belongs to the previous trading day. The aggregator's own date field SHALL NOT be used as the business date. Where the settlement record carries a date but no time, the placement timestamp SHALL be obtained from the aggregator's order record and joined on the order identifier.

An order whose placement timestamp cannot be established SHALL NOT be attributed to a guessed day; it SHALL be held unattributed and reported.

#### Scenario: A late-night order stays on the trading day it was cooked

- **WHEN** an order is placed at 00:30, after an outlet whose cutover is 04:00 has begun a new calendar day
- **THEN** it is attributed to the previous business date, matching the date the counter's own takings for that shift carry

#### Scenario: An order at the cutover opens the new day

- **WHEN** an order is placed at exactly the outlet's cutover time
- **THEN** it is attributed to the new business date, consistent with the cutover being an inclusive start

#### Scenario: A timestamp cannot be found

- **WHEN** a settlement row has no matching order record from which to read a placement time
- **THEN** the order is not written against any business date, and the sync reports it as unattributed rather than falling back to the aggregator's own date

### Requirement: An unpaid week reads as provisional and a paid week replaces it

Each synced day SHALL carry a settlement state. A day belonging to a payout cycle the aggregator has not yet paid SHALL be stored as **provisional**. Once that cycle is paid, its days SHALL be rewritten from the settlement record and stored as **settled**.

A settled figure SHALL supersede a provisional one for the same outlet and business date without creating a second row. A settled day SHALL NOT be returned to provisional by a later run.

Where settlement changes a day's figures, the provisional figures SHALL be retained alongside the settled ones and the day SHALL read as **revised**, stating what the figures changed from. A day whose figures settle unchanged SHALL NOT be marked revised. The two sources disagree by design: the live dashboard omits refunds paid to the restaurant when an order is cancelled after preparation, so a provisional day can understate what is eventually paid, and a figure moving upward days later is expected rather than alarming. It is recorded so that a figure never moves without a trace of what it moved from.

The surface SHALL state which state a figure is in wherever that figure is read.

#### Scenario: This week's revenue is marked provisional

- **WHEN** the sync writes a business date inside a payout cycle that has not been paid
- **THEN** the day is stored as provisional and reads on screen as provisional

#### Scenario: Settlement replaces the estimate in place

- **WHEN** a cycle that was previously written as provisional becomes paid, and the sync runs
- **THEN** each of that cycle's days is rewritten from the settlement record, marked settled, and remains one row per outlet per business date

#### Scenario: A cancellation refund appears only on settlement

- **WHEN** a cycle contains an order rejected after preparation, for which the aggregator refunded the restaurant a share
- **THEN** the settled figures include that refund even though the provisional figures did not, the day's net increases when the cycle settles, and the day reads as revised

#### Scenario: A revised day says what it was

- **WHEN** the owner reads a day whose settled figures differ from the provisional ones it carried
- **THEN** the retained provisional figures are shown beside the settled ones, so the owner can see what the figure changed from and by how much

#### Scenario: An unchanged day is not marked revised

- **WHEN** a cycle settles and a day's figures are identical to the provisional ones already stored
- **THEN** the day reads as settled and is not marked revised

#### Scenario: A settled day is not downgraded

- **WHEN** a later run reads the live dashboard for a date already stored as settled
- **THEN** the stored settled figures are unchanged

### Requirement: A settled week is written only if it reconciles against the payout actually made

Before writing a settled cycle, the sync SHALL verify that the sum of that cycle's per-order payouts, less that cycle's deductions, equals the payout amount the aggregator states it paid.

Where the two agree within a tolerance of one rupee, the cycle SHALL be written; a discrepancy inside that tolerance arises from the aggregator rendering every figure to two decimal places. Where they disagree by more than that tolerance, the cycle SHALL NOT be written, and the discrepancy SHALL be reported with the outlet, the cycle, both figures and their difference.

A cycle refused for this reason SHALL leave any previously stored figures for its dates untouched, and its business dates SHALL read as **disputed** rather than continuing to read as provisional.

A disputed week has already been paid, so it will never settle of its own accord, which is what separates it from a week still awaiting payment. Left reading as provisional it would be indistinguishable from the current week and would sit unresolved without anyone noticing. It SHALL remain disputed until either a later run reconciles it, whereupon it becomes settled, or the owner resolves it through the actions the sync's own surface offers.

#### Scenario: A reconciling cycle is written

- **WHEN** a settled cycle's per-order payouts less its deductions equal the stated payout to within one rupee
- **THEN** its days are written as settled

#### Scenario: A discrepancy stops the write

- **WHEN** a settled cycle's computed total differs from the stated payout by more than one rupee
- **THEN** no day of that cycle is written, the previously stored figures for those dates are unchanged, and the discrepancy is reported naming the outlet, the cycle, both totals and the difference

#### Scenario: A disputed week is not mistaken for the current week

- **WHEN** a paid cycle has been refused for failing to reconcile
- **THEN** its business dates read as disputed rather than provisional, distinguishable from a week that is merely awaiting payment

#### Scenario: A later run resolves a dispute

- **WHEN** a cycle previously refused reconciles on a later run, because the aggregator's own figures have since changed
- **THEN** its days are written as settled and no longer read as disputed

#### Scenario: Rounding noise does not raise an alarm

- **WHEN** a cycle's computed total differs from the stated payout by a few paise
- **THEN** it is treated as reconciled and written, and no discrepancy is reported

### Requirement: Aggregator deductions are recorded as expenses dated to when the spend happened

Deductions the aggregator takes from a payout, such as supply purchases and advertising, SHALL be recorded as expense rows dated to the business date of the **spend itself**, not to the date of the payout that collected it. A deduction has been observed settling four to eleven days after the purchase, sometimes in a later cycle than the one containing its date.

Each such expense SHALL carry the identity of the record it came from, so that repeated runs update the same row rather than creating another, and so that a hand-entered row for the same purchase is recognisable as a duplicate rather than silently doubling the month's costs.

A hand-entered row and a sourced row for the same purchase SHALL be recognised as a possible duplicate **without requiring their amounts or dates to be equal**, because a typed figure is rounded and typed dates record when a bill was noticed rather than when it was paid. The surface SHALL present both rows with their own amount, date and note, and SHALL offer settling the flag without changing either row, since the same purchase genuinely occurring twice in a day is ordinary.

An expense sourced this way SHALL be marked non-cash, because it never passed through the drawer.

#### Scenario: A supply bill lands on its purchase date

- **WHEN** a supply deduction dated the 1st is collected by a payout on the 12th
- **THEN** the expense is recorded against the 1st, and the month containing the 1st carries the cost

#### Scenario: Re-running does not duplicate a deduction

- **WHEN** the sync runs again over a window that already produced a deduction expense
- **THEN** the existing row is updated in place and no second row is created for the same source record

#### Scenario: A rounded figure on a nearby day is still a possible duplicate

- **WHEN** a supply deduction of ₹3,747.77 dated the 16th arrives at an outlet where the owner has already entered ₹3,750 on the 15th
- **THEN** the two are presented together as a possible duplicate, each showing its own amount, date and note, and neither is altered

#### Scenario: Both are real

- **WHEN** the owner settles a possible duplicate by saying both purchases happened
- **THEN** the flag stops asking, both expenses continue to count, and neither row is changed

#### Scenario: A deduction never touches the drawer

- **WHEN** a deduction expense is written
- **THEN** it is marked non-cash, and the day's expected cash and difference are unchanged

### Requirement: A deduction belonging to no trading day is never attributed to one

A cycle-level deduction SHALL be recognised as such and stored as its own deduction record against the outlet and the period it names. It SHALL NOT be attributed to a business date, SHALL NOT contribute to any day's revenue, and SHALL NOT be recorded as an expense category.

The aggregator emits these, such as tax deducted at source, through the same channel as orders: carrying an identifier that names a deduction kind, an outlet and a period rather than an order, a null date that renders as an epoch date, a rejected status and a negative amount. Such a record refers to a period that is not the cycle it is paid in, so attributing it to the cycle that carries it would misdate it as well as misplace it.

#### Scenario: A tax deduction is recognised, not booked as a day

- **WHEN** the settlement record contains a row whose identifier marks it as a cycle-level deduction with a null date
- **THEN** it is stored against the outlet and the period it names, and no business date's revenue changes

#### Scenario: An epoch date never reaches the ledger

- **WHEN** a record carries a null date rendering as 1 January 1970
- **THEN** no ledger row is created for that date

### Requirement: A synced figure supersedes a typed one while preserving what was typed

Where the sync produces a figure for an outlet and business date on which the owner had already entered one, the synced figure SHALL become the day's value and the entered figure SHALL be retained and readable alongside it, with the moment it was superseded.

The retained figure SHALL NOT participate in any revenue or profit computation. It exists so the owner can see how far the manual estimates ran from the settled truth.

#### Scenario: A typed day is taken over

- **WHEN** the sync writes a business date that already carries an owner-entered aggregator figure
- **THEN** the synced figure becomes the day's value, the entered figure is retained with the time it was superseded, and the month computes from the synced figure only

#### Scenario: The owner can see what they had guessed

- **WHEN** the owner reads a day whose typed figure was superseded
- **THEN** both the synced figure and the retained typed figure are shown, distinguishable from one another

### Requirement: The owner has one surface listing what the sync changed, in which a row is an event rather than a run

The owner SHALL have a single surface reporting the sync's activity. A row on it SHALL be an event: a day's figures written, a week settled, a day revised, a week disputed, a session lapsed, or a possible duplicate expense. A run that changed nothing SHALL NOT occupy a row of its own.

The surface SHALL state when the sync last ran and whether it succeeded, so that quiet is distinguishable from broken without a row per run. The sync runs several times a day against every outlet, so a row per run would bury the events worth reading inside a majority that report nothing.

An event row SHALL be collapsed by default and SHALL state in one line what changed. Where the event replaced a figure, that line SHALL state what the figure changed from as well as what it changed to. A row requiring the owner to act SHALL be presented expanded, with the actions available on it.

The sync SHALL distinguish its failure states, because they need different people: a lapsed aggregator session, which the owner resolves; an aggregator response whose shape is no longer understood, which a maintainer resolves; and a reconciliation discrepancy, which is a question about money. A lapsed session SHALL be surfaced to the owner as an action they can take.

Where the sync cannot obtain data for a date, it SHALL write nothing for that date and report the failure. It SHALL NOT write a zero, and SHALL NOT overwrite an existing figure with an empty one.

#### Scenario: A quiet week does not fill the surface

- **WHEN** the sync has run repeatedly with nothing to change
- **THEN** the surface states when it last ran and that it succeeded, and lists no row for those runs

#### Scenario: An overwrite says what it was

- **WHEN** the surface lists an event in which a stored figure was replaced
- **THEN** the row states the figure it changed from and the figure it changed to, without the owner needing to expand it

#### Scenario: Only actionable rows are open

- **WHEN** the surface is opened on a list containing both an ordinary settlement and a disputed week
- **THEN** the settlement row is collapsed and the disputed row is presented expanded with its actions

#### Scenario: A lapsed session asks the owner to act

- **WHEN** the aggregator session is no longer valid
- **THEN** the surface says so and offers reconnecting as an action, rather than reporting a generic failure

#### Scenario: A failed fetch writes nothing

- **WHEN** the sync cannot retrieve a date's data
- **THEN** no row is written or modified for that date, any previously stored figure is unchanged, and the failure is reported

#### Scenario: Failure states are told apart

- **WHEN** the sync fails
- **THEN** the report names which of the three states occurred, and a lapsed session is not reported as a shape change or a discrepancy

### Requirement: A disputed week may be re-checked or accepted with its difference recorded, and by nothing that conceals it

A disputed week SHALL offer the owner re-checking it and accepting it, and SHALL NOT offer an action that stores figures without accounting for the difference that made it disputed.

**Re-checking** SHALL read the cycle from the aggregator again and reconcile it again. Where it now reconciles, the cycle SHALL be written and its days settled. Aggregator figures have been observed to change after a payout, so most disputes are expected to resolve this way.

**Accepting** SHALL write the aggregator's own per-order figures and SHALL record the remaining difference as its own record against the outlet and the cycle, attributed to no business date, readable as an unexplained settlement difference. The accepted difference SHALL be recorded with the account that accepted it and the moment they did.

Accepting SHALL NOT adjust any day's figures to close the gap, because a difference spread silently across days would leave every day slightly wrong and the discrepancy unfindable.

#### Scenario: Re-checking resolves the dispute

- **WHEN** the owner re-checks a disputed week and the aggregator's figures now reconcile
- **THEN** the cycle is written, its days read as settled, and no difference is recorded

#### Scenario: Accepting records the gap rather than hiding it

- **WHEN** the owner accepts a disputed week whose computed total is short of the stated payout
- **THEN** the aggregator's per-order figures are written, the remaining difference is stored against the outlet and cycle as an unexplained settlement difference with who accepted it and when, and no day's figures are adjusted

#### Scenario: The gap cannot be silently absorbed

- **WHEN** a disputed week is presented to the owner
- **THEN** no offered action writes the cycle without either reconciling it or recording the difference

### Requirement: Running the sync twice produces the same ledger as running it once

Every write the sync makes SHALL be keyed on the aggregator's own identity for that record, so that re-running over an overlapping window updates rows rather than adding them.

The sync SHALL re-read recent history on every run rather than only the newest day, because both revenue figures and deductions arrive late. It SHALL cover at least the two most recent payout cycles for orders and the four most recent for deductions.

#### Scenario: An overlapping run changes nothing

- **WHEN** the sync runs twice over the same window with no change at the aggregator
- **THEN** the second run leaves every ledger row byte-for-byte unchanged and creates none

#### Scenario: A late arrival is picked up

- **WHEN** an order or deduction appears at the aggregator for a date already synced
- **THEN** a subsequent run within the re-read window incorporates it into that date's stored figures

### Requirement: Synced records are readable only by those who may already read the outlet

Every table this capability introduces SHALL carry Row-Level Security policies enforcing outlet isolation in the database, matching the reach the ledger already grants: the owner across outlets, and no Franchise Admin, Biller or Employee reaching another outlet's rows or these financial rows at all.

#### Scenario: A Franchise Admin cannot reach settlement records

- **WHEN** a Franchise Admin issues a hand-crafted request for another outlet's settlement or deduction records
- **THEN** the database refuses it

#### Scenario: A Biller and an Employee are refused outright

- **WHEN** a Biller or an Employee issues a hand-crafted request for any settlement or deduction record, including their own outlet's
- **THEN** the database refuses it
