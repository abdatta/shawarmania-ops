# Business Figures

## Purpose

Give revenue, commission, expenses and profit, the month to date and a comparison one definition, which every surface that shows them obeys, so two screens reading the same outlet and dates agree to the paisa.

## Requirements

### Requirement: Revenue, commission, expenses and profit mean one thing everywhere

Every surface that shows revenue, expenses or profit for an outlet SHALL compute
them by one definition, and two surfaces showing the same outlet and business
dates SHALL show the same figures to the paisa.

- **Revenue** SHALL be the effective cash and UPI allocations of settled bills
  whose business date is in the period, plus each delivery channel's stated sales
  for those dates **before commission**. Delivery not yet imported SHALL count as
  nothing and SHALL NOT be qualified on Overview.
- **Commission** SHALL be derived per channel and per business date from the
  channel's stated figures, as its sales less what the outlet receives, from the
  date the platform states it. An unstated commission SHALL contribute nothing
  and that date SHALL be counted as waiting. Commission SHALL NOT be stored as an
  expense row.
- **Expenses** SHALL be the recorded expenses for the period plus commission.
- **Profit** SHALL be revenue less expenses, as a cash-basis operating estimate.

All arithmetic SHALL be integer paise. Commission SHALL be derived per channel
and date before it is summed.

#### Scenario: Three surfaces, one month

- **WHEN** the owner reads an outlet's October to date on Overview, on the
  Ledger's October month view, and on Analytics with Month selected
- **THEN** all three show the same revenue, and Overview and the Ledger show the
  same expenses and profit

#### Scenario: A charge on a day with no orders

- **WHEN** a channel states ₹0 sales and a received amount of −₹611.07 for a date
- **THEN** that date adds ₹0 to revenue and ₹611.07 to expenses as delivery
  commission, and no revenue figure goes negative

#### Scenario: Commission not yet stated

- **WHEN** a channel's commission for a date is not yet stated
- **THEN** that date's sales count in revenue, it adds no commission, and the
  Ledger counts it among the days waiting

#### Scenario: Profit matches the earlier basis

- **WHEN** a month's commissions are all stated
- **THEN** profit equals counter revenue plus each channel's received amount less
  recorded expenses, which is the profit the Ledger reported before this change

### Requirement: The month runs through today, and a comparison is the same dates up to the same time

The current month SHALL run from its 1st through the outlet's current business
date, resolved through the outlet's cutover. A comparison with an earlier month
SHALL use the same day-of-month span, with its last date clamped to that month's
length; a whole month SHALL compare with whole months.

When a compared window ends today, the matched last date of each earlier window
SHALL count counter bills ordered only up to the same time elapsed since that
date's business-day start as has elapsed today, and SHALL count its delivery
only once today's delivery has been imported. Where the matched date was
clamped, the earlier window SHALL count whole. A chart point or table row for an
earlier date SHALL remain that date's whole figure; only comparison figures are
cut.

Where an earlier window has no sales, the comparison SHALL say so in words and
SHALL NOT show a percentage.

#### Scenario: Mid-month afternoon

- **WHEN** it is 15:40 on 15 October at an outlet whose day changes at 04:00
- **THEN** October 1–15 is compared with September 1–14 whole and September 15
  up to 15:40

#### Scenario: A longer month against a shorter one

- **WHEN** it is 31 October
- **THEN** October 1–31 is compared with the whole of September 1–30, uncut

#### Scenario: An outlet with no earlier month

- **WHEN** an outlet opened on 1 October and it is 15 October
- **THEN** the comparison reads *No sales 1–15 Sep* with no percentage

#### Scenario: The server decides today

- **WHEN** a phone's clock is a day wrong
- **THEN** Overview's month, today and cut are still those of the server's clock
  and the outlet's cutover
