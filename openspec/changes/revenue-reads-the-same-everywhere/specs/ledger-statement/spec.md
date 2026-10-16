## RENAMED Requirements

- FROM: `### Requirement: Each aggregator day is netted at its own rate, and an undetermined day makes the month a ceiling`
- TO: `### Requirement: Each aggregator day's commission is its own expense, and an unstated one is named`

## MODIFIED Requirements

### Requirement: The day reads in two sections, and only cash reaches the drawer

The reading SHALL carry a **revenue** section and a **drawer** section.

Revenue SHALL show Cash and UPI derived from counter allocations, and each
aggregator channel as a sourced reading with its sales before commission, its
commission and what was received, each carrying its settlement state. The day's
**revenue** SHALL be cash, UPI and each channel's sales before commission, as
defined by `business-figures`. A commission not yet stated SHALL read as not
known yet and SHALL NOT read as nought.

The day's expenses SHALL include, for each channel whose commission is stated, a
**Delivery commission** line for that channel, derived on read, with no recorder
and no edit or withdraw action. It SHALL count in the day's expenses total.

The drawer section SHALL contain only cash movements. UPI, Swiggy and Zomato, and
their commission, SHALL appear in revenue and expenses and SHALL move no drawer
figure. A cash expense SHALL appear in both the expenses total and the drawer; a
non-cash expense SHALL appear only in the expenses total.

#### Scenario: A UPI expense does not move the drawer

- **WHEN** a day carries a ₹900 cash expense and a ₹300 UPI expense
- **THEN** the expenses total is ₹1,200 and the drawer falls by ₹900

#### Scenario: A stated commission is a day's expense

- **WHEN** Zomato states ₹2,000 of sales and ₹1,400 received for a day
- **THEN** revenue includes ₹2,000, the expenses carry a ₹600 Zomato commission
  line, and the drawer does not move

#### Scenario: An unstated aggregator commission

- **WHEN** a channel's commission for that day is not yet stated
- **THEN** the reading says it is not known yet, the day's revenue includes the
  channel's sales, and no commission line appears

### Requirement: The month reports what the month earned, spent and kept

The ledger SHALL offer a month reading for one outlet, derived from the same
sources as its days and storing no row of its own. Its current month SHALL run
through today's business date resolved through the outlet's own cutover. It SHALL
report:

- **revenue**: cash and UPI derived from bill allocations, and each aggregator
  channel's sales before commission, with what each channel's days received
  beneath;
- **expenses**: grouped by category, with every line beneath its category
  carrying that line's business date, its note where it has one, and whether it
  came out of the drawer, and with **Delivery commission** as a category of
  derived lines, one per channel per date with a stated commission;
- **an operating profit estimate**: revenue less expenses, with its basis stated
  on screen.

Every figure SHALL be integer paise and SHALL equal what `business-figures`
defines for the same outlet and dates. No figure on the month reading SHALL be
presented as an input.

The profit figure SHALL be an **operating** estimate and SHALL say so: cash out
that is not a running cost is deliberately outside it, and SHALL remain listed on
the month reading so that such a purchase is findable without knowing its date.

#### Scenario: A month of trading reads as a month

- **WHEN** an outlet has traded for a full month with commissions stated
- **THEN** the reading reports cash, UPI and each channel's sales and received
  amounts, the expenses by category including Delivery commission, and a profit
  figure naming its basis

#### Scenario: A large cash purchase stays outside the operating figure

- **WHEN** a ₹40,000 freezer is paid from the drawer during the month
- **THEN** it is listed on the month reading and the profit figure is unchanged by it

#### Scenario: Today is in the month

- **WHEN** the current month is opened at 15:00 on the 15th
- **THEN** its figures include today's bills so far, and equal Overview's month to
  date to the paisa

### Requirement: Each aggregator day's commission is its own expense, and an unstated one is named

Each aggregator day's commission SHALL be derived from **that day's** stated
figures and then summed, so a rate that changes mid-month SHALL be correct on both
sides of the change and SHALL NOT reach days it did not govern.

A day whose commission is not yet stated SHALL contribute its sales to revenue
and nothing to expenses. Where any day in the month is waiting, the month SHALL
state **how many**, beside its profit, and that profit falls by their commission
once stated. Revenue SHALL NOT be presented as a ceiling, because it no longer
depends on the commission. A commission not yet stated SHALL NOT read as nought.

#### Scenario: A renegotiated rate mid-month

- **WHEN** a channel's commission rate differs across two halves of a month
- **THEN** each day's commission is derived from that day's figures and neither
  rate reaches the other's days

#### Scenario: Three days still waiting

- **WHEN** three days in the month carry a commission not yet stated
- **THEN** revenue reads without qualification, the reading says three days'
  delivery commission is not stated yet beside the profit, and those days add no
  commission

#### Scenario: A settled month states nothing waiting

- **WHEN** every day's commission in the month is stated
- **THEN** no waiting line appears and the figures read as final

### Requirement: The month reports what it gave away, beside what it earned

The month SHALL report the total discount given across its bills as its own
section, and SHALL state that its revenue figures are net of it.

The figure SHALL be reported for the month even where the month's other
qualifications apply.

#### Scenario: A month running a discount

- **WHEN** a month's bills carry discounts
- **THEN** the month reports the total given away beside its revenue, and names
  the revenue as net of it

#### Scenario: A month with no billed date

- **WHEN** a month has no recorded sales at all
- **THEN** it says so, and offers no discount figure rather than nought
