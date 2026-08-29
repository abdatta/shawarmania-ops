# Ledger Statement

## Purpose

Presents a trading day as a reading derived on every read and never stored: revenue by channel, the drawer ordered by the instant each movement happened, and the expenses that came out of it. It carries no editable field, distinguishes the float left behind from the closing balance, and states plainly when a day's balances are unconfirmed rather than presenting an unchecked belief as a counted figure. Verifying a day is an attributed acknowledgement that freezes nothing, because settlement legitimately restates a day after somebody has read it.

## Requirements

### Requirement: A ledger day is derived on read and is never stored

The per-day ledger reading SHALL be computed on read from bills, expenses,
sourced aggregator channel days, drawer cash out and drawer observations. No
table SHALL store a per-outlet-per-day ledger row, and no figure on the reading
SHALL be writable.

A business date at which nothing was recorded SHALL still render in full.

#### Scenario: A day nobody touched

- **WHEN** a business date with no observation, no expense and no aggregator figure is opened
- **THEN** the day renders completely, with its derived balances and zeroes rather than an empty state

#### Scenario: No stored row can disagree with its sources

- **WHEN** any figure contributing to a day changes
- **THEN** the day's reading reflects it on the next read, with no stored row to reconcile

### Requirement: The day reads in two sections, and only cash reaches the drawer

The reading SHALL carry a **revenue** section and a **drawer** section.

Revenue SHALL show Cash and UPI derived from counter allocations, and each
aggregator channel as a sourced reading with its gross, its commission and its
net, each carrying its settlement state. A commission not yet determined SHALL
read as not known yet and SHALL NOT read as nought.

The drawer section SHALL contain only cash movements. UPI, Swiggy and Zomato
SHALL appear in revenue and SHALL move no drawer figure. A cash expense SHALL
appear in both the expenses total and the drawer; a non-cash expense SHALL appear
only in the expenses total.

#### Scenario: A UPI expense does not move the drawer

- **WHEN** a day carries a ₹900 cash expense and a ₹300 UPI expense
- **THEN** the expenses total is ₹1,200 and the drawer falls by ₹900

#### Scenario: An unsettled aggregator commission

- **WHEN** a channel's commission for that day is undetermined
- **THEN** the reading says it is not known yet and the month is presented as a ceiling

### Requirement: The drawer section is ordered by instant, not grouped by category

The drawer section SHALL present its movements in the order they occurred:
opening at the cutover, then the movements and observations of the day in
instant order, then the closing balance at the next cutover. An expense that
occurred before an observation SHALL appear above it and one that occurred after
SHALL appear below it.

Each observation SHALL appear as a block naming the expected total, the counted
total, any unexplained variance on its own line, the amount collected, the
amount left, whether the recorder was on site, and both instants. A day
containing two observations SHALL show two blocks.

#### Scenario: An expense after the count

- **WHEN** a cash expense occurs after that day's observation
- **THEN** it appears below the observation block and inside the after-count movements

#### Scenario: A variance takes its own line

- **WHEN** an observation recorded a shortfall
- **THEN** the block carries an explicit unexplained line and the section still adds to the closing balance

### Requirement: A day with no observation states that its balances are unconfirmed

Where no observation falls within a business date, the reading SHALL mark both
the opening and the closing balance as carried, and SHALL name when the drawer
was last confirmed. Where an observation's interval spans several business
dates, the reading SHALL say how many days that observation covers.

#### Scenario: Three uncounted days

- **WHEN** three consecutive business dates carry no observation
- **THEN** each marks its balances carried and names the last confirmed instant

#### Scenario: A count covering several days

- **WHEN** an observation's interval spans three business dates
- **THEN** the reading states that the count covers three days

### Requirement: The float left is distinguished from the closing balance

The amount left in the drawer at an observation and the drawer balance at the
next cutover SHALL be presented as separate, separately named figures. The
reading SHALL NOT use one word for both, and SHALL make plain that trade after
an observation means the amount left is not the next day's opening.

#### Scenario: Trade continues after the collection

- **WHEN** ₹1,450 is left at 22:00 and ₹2,054 of cash is taken afterwards
- **THEN** the reading shows ₹1,450 left and ₹3,504 closing, named differently

### Requirement: The ledger reading carries no editable field

The ledger surface SHALL offer no input that writes a figure. Its only controls
SHALL be the date stepper, expansion of a row, and verification. A figure judged
wrong SHALL be corrected at its source: a void and re-ring for a bill, a
withdrawal and re-entry for an expense, an adjustment for an observation.

#### Scenario: No figure can be typed

- **WHEN** the ledger day is rendered in any role that can reach it
- **THEN** no revenue, drawer or expense figure is presented as an input

### Requirement: Verifying a day is an attributed acknowledgement, and freezes nothing

A day MAY be verified at any time after it, recording the account, the instant
and an optional note. Verification SHALL NOT freeze any figure, SHALL NOT be
required for a day to exist, and SHALL NOT be required for a month to compute,
because settlement legitimately restates a day's figures afterwards.

Where a figure a verified day depends on changes after verification, the day
SHALL be marked as changed since it was verified, naming what moved.

Each day SHALL join a verification by an action of its own. No control SHALL
verify more than one day at a time.

#### Scenario: Verifying several days later

- **WHEN** an account verifies a business date three days after it
- **THEN** the verification is recorded with its account, instant and note

#### Scenario: A settlement lands after verification

- **WHEN** an aggregator cycle settles and restates a verified day's figures
- **THEN** the day is marked changed since verified, naming the figure that moved, and nothing is blocked

#### Scenario: No bulk verification

- **WHEN** several days are reviewed in one sitting
- **THEN** each is verified by its own action and no control verifies them together
