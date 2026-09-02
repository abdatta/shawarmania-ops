# Delta: ledger-statement

## ADDED Requirements

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
