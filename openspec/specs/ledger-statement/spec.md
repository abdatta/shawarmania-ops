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

### Requirement: The month reports what the month earned, spent and kept

The ledger SHALL offer a month reading for one outlet, derived from the same
sources as its days and storing no row of its own. It SHALL report:

- **revenue** — cash and UPI derived from bill allocations, and each aggregator
  channel with its gross, its commission and its net;
- **expenses** — grouped by category, with every line beneath its category
  carrying that line's business date, its note where it has one, and whether it
  came out of the drawer;
- **an operating profit estimate** — revenue received less everything recorded as
  spent, with its basis stated on screen.

Every figure SHALL be integer paise. No figure on the month reading SHALL be
presented as an input.

The profit figure SHALL be an **operating** estimate and SHALL say so: cash out
that is not a running cost is deliberately outside it, and SHALL remain listed on
the month reading so that such a purchase is findable without knowing its date.

#### Scenario: A month of trading reads as a month

- **WHEN** an outlet has traded for a full month with commissions settled
- **THEN** the reading reports cash, UPI and each channel's net, the expenses by
  category, and a profit figure naming its basis

#### Scenario: A large cash purchase stays outside the operating figure

- **WHEN** a ₹40,000 freezer is paid from the drawer during the month
- **THEN** it is listed on the month reading and the profit figure is unchanged by it

### Requirement: Each aggregator day is netted at its own rate, and an undetermined day makes the month a ceiling

Each aggregator day SHALL be netted using the commission stored against **that
day**, and the results added. A rate that changes mid-month SHALL therefore be
correct on both sides of the change, and SHALL NOT be applied to days it did not
govern.

Where a day's commission is undetermined, that day SHALL contribute **its gross**
to the month's net, so the total states the most that can have arrived rather than
less than certainly did. The month's commission total SHALL be derived as gross
less net, so that a determined-only commission and a ceiling net cannot disagree.

A month containing any undetermined day SHALL be presented as a ceiling on every
figure that day reaches — the channel's net, the revenue total and the profit
estimate — and SHALL state **how many** days are still waiting. A commission not
yet determined SHALL NOT read as nought.

#### Scenario: A renegotiated rate mid-month

- **WHEN** a channel's commission rate differs across two halves of a month
- **THEN** each day is netted at its own rate and neither rate reaches the other's days

#### Scenario: Three days still waiting

- **WHEN** three days in the month carry an undetermined commission
- **THEN** the revenue and profit read as ceilings, the reading says three days are
  waiting, and those days contribute their gross

#### Scenario: A settled month states no ceiling

- **WHEN** every day's commission in the month is determined
- **THEN** no ceiling language appears and the figures read as final

### Requirement: A date with no recorded sales is named, and no cause is claimed

A date on which nothing was sold — not at the counter and not on any channel —
contributes nothing to the month. The reading SHALL report its aggregate
regardless, and SHALL state **how many** of the period's dates recorded no sales
at all. Those dates SHALL be nameable exactly, on an action, rather than only
counted.

**Every revenue source counts toward this, not bills alone.** A date the counter
never billed but an aggregator did is a trading date and SHALL NOT be reported as
having no sales. August 2026 at Kalyani is the case that settles it: the counter
did not bill until the twelfth, and the month still holds no silent date, because
Zomato and Swiggy recorded revenue throughout.

That statement SHALL claim only what the record holds. It SHALL NOT assert a
reason — that the outlet was not yet billing, was closed, or was unable to bill —
because the app cannot distinguish those, and no stored marker for when an outlet
began billing SHALL be required or relied upon.

Because expenses on such a date are recorded and real, a period containing them
reports revenue for some of its dates and costs for all of them, and its profit is
understated. The statement SHALL therefore qualify **the profit figure as well as
the revenue total**, and SHALL NOT be presented as a fact about sales alone.

Where **no** date in the period records a sale, the reading SHALL state that there
are no recorded sales for it and SHALL offer **no profit figure**: profit requires
both halves, and with one wholly absent there is no figure to state rather than a
smaller one. That period's expenses SHALL still be reported.

#### Scenario: Some dates recorded no sales

- **WHEN** eleven of a month's thirty-one dates record no sales from any source
- **THEN** the reading reports the month's figures, states that eleven dates had
  no sales, names those eleven dates on an action, and qualifies the profit figure

#### Scenario: No cause is asserted

- **WHEN** a date records no sales
- **THEN** the reading says no sales were recorded for it and does not say why

#### Scenario: A month with no sale on any date

- **WHEN** no date in the month records a sale
- **THEN** the reading states there are no recorded sales for that month, offers
  no profit figure, and still lists that month's expenses

### Requirement: A channel that reported nothing is named, never omitted

The month reading SHALL present a section for **every delivery channel that
outlet trades on**, whether or not the channel produced a figure for any date in
the period. Where such a channel produced none, the reading SHALL say so in words
and SHALL NOT render a nought figure for it.

Which channels an outlet trades on SHALL be read from the outlet’s own channel
mapping, not assumed from the set of channels the application supports. An outlet
that does not sell on a channel SHALL NOT have that channel reported at all,
neither as figures nor as having recorded nothing: figures of nought would be
noise on every period, and an alarm about a channel nobody expected to report is
a false one.

A channel the outlet is not mapped to SHALL still be presented, and SHALL still
count toward the revenue total, **where it reported revenue**. Money SHALL NOT be
hidden because a mapping is absent.

A channel that took no orders and a channel whose sync never ran are
indistinguishable in the recorded data. Omitting the channel therefore reports a
revenue total that appears complete and may not be, which is the same failure as
rendering an unstated commission as nought. The reading SHALL say that the two
cannot be told apart and SHALL point at where the sync's health is stated.

A channel that produced figures of nought is **not** a channel that reported
nothing: rows exist and they say nought, which is a measurement. The two SHALL be
rendered differently.

#### Scenario: A channel the outlet trades on produced no figures all month

- **WHEN** no figure for a mapped channel reached the outlet on any date in the period
- **THEN** the reading names that channel, says it recorded nothing, and does not
  show a nought figure for it

#### Scenario: A mapped channel reported nought

- **WHEN** a channel the outlet trades on reported a figure of nought on nineteen dates
- **THEN** it renders as a channel with figures, not as one that recorded nothing

#### Scenario: An outlet that does not sell on a channel is not told about it

- **WHEN** an outlet has no mapping for a channel and that channel reported no revenue
- **THEN** the reading omits that channel entirely, reporting neither figures nor
  that it recorded nothing

#### Scenario: An unmapped channel that took money is still reported

- **WHEN** a channel the outlet is not mapped to reports revenue for the period
- **THEN** it appears in the breakdown and counts toward the revenue total

#### Scenario: A silent channel does not silently shrink the total

- **WHEN** a channel recorded nothing for the period
- **THEN** the reading states that the two possible reasons cannot be told apart,
  rather than leaving the reader to infer the channel took no orders

### Requirement: The month states how far its drawer figures can be trusted, in one line

The month reading SHALL state, in a single line, how many of its dates were
counted and how many are carried, and SHALL offer a route to the day reading
where the detail lives. A month of carried dates is the signal that nobody has
counted the drawer in a long time, and SHALL remain visible on the month.

Dates before the outlet's anchor are **not tracked yet** and SHALL be counted as
neither counted nor carried, because there is no belief there to leave unchecked.
A month wholly before the anchor SHALL say so rather than reporting nought
counted dates.

The month reading SHALL NOT present the drawer's balances date by date. That
detail belongs to the day reading.

#### Scenario: Three uncounted dates in a month

- **WHEN** twenty-eight of a month's thirty-one dates carry an observation
- **THEN** the reading states twenty-eight counted and three carried, in one line

#### Scenario: A month before the outlet was tracked

- **WHEN** every date in the month precedes the outlet's anchor
- **THEN** the reading says the drawer was not tracked yet and reports no counted
  or carried tally
