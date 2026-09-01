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

### Requirement: A date with no bills is reported as a date with no sales, and no cause is claimed

Revenue is derived from bills, so a date carrying none contributes nothing to the
month. The reading SHALL report its aggregate regardless, and SHALL state **how
many** of the period's dates carried no bills. Those dates SHALL be nameable
exactly, on an action, rather than only counted.

That statement SHALL claim only what the record holds. It SHALL NOT assert a
reason — that the outlet was not yet billing, was closed, or was unable to bill —
because the app cannot distinguish those, and no stored marker for when an outlet
began billing SHALL be required or relied upon.

Because expenses on such a date are recorded and real, a period containing them
reports revenue for some of its dates and costs for all of them, and its profit is
understated. The statement SHALL therefore qualify **the profit figure as well as
the revenue total**, and SHALL NOT be presented as a fact about sales alone.

Where **no** date in the period carries a bill, the reading SHALL state that there
are no recorded sales for it and SHALL offer **no profit figure**: profit requires
both halves, and with one wholly absent there is no figure to state rather than a
smaller one. That period's expenses SHALL still be reported.

#### Scenario: Some dates carried no bills

- **WHEN** eleven of a month's thirty-one dates carry no bills
- **THEN** the reading reports the month's figures, states that eleven dates had
  no sales, names those eleven dates on an action, and qualifies the profit figure

#### Scenario: No cause is asserted

- **WHEN** a date carries no bills
- **THEN** the reading says no sales were recorded for it and does not say why

#### Scenario: A month with no billed date at all

- **WHEN** no date in the month carries a bill
- **THEN** the reading states there are no recorded sales for that month, offers
  no profit figure, and still lists that month's expenses

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
