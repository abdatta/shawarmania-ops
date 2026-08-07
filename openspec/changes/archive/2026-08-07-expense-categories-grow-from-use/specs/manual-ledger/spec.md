## MODIFIED Requirements

### Requirement: An expense is its own row, categorised and marked cash or non-cash

Each expense SHALL be stored as one row carrying an outlet, an explicit
business date, a **required category**, whether it was paid in cash, an amount in
integer paise, and an optional note. Any number of expense rows SHALL be
permitted for one outlet and business date.

The category SHALL be free text drawn from the business-wide growing list
defined by `expense-categories`, and SHALL be mandatory, because a category and
an amount alone do not identify a purchase weeks later and an expense nobody can
identify is not a record. It SHALL be refused when blank or whitespace-only, by
the database and not only by the form, under the same rule every other required
field in the app already follows.

The note SHALL be free text and SHALL be optional, carrying detail the category
does not, such as a quantity. It SHALL be refused when present but blank or
whitespace-only, exactly as the day's note is. It SHALL NOT be mandatory,
because the requirement that an expense identify itself is now carried by the
category, and requiring both would mean typing the same words twice.

A category SHALL NOT be an aggregator commission, cash banked or an owner
drawing, because each of those is accounted for elsewhere and a category for one
would double-count it. Because the category is free text, this SHALL be enforced
as a warning rather than as a refusal, as `expense-categories` states.

A capital purchase (equipment, fittings or anything whose useful life exceeds
the month) SHALL NOT be recorded as an expense row, and no capital marker SHALL
exist on the expense table. Such a purchase is out of this capability's scope by
owner decision, so the monthly estimate it produces is an operating figure.

Where a capital purchase is nevertheless paid from the drawer, it SHALL be
recorded as cash taken out with its reason, so that expected cash still
reconciles against the count. Recording it that way SHALL keep it out of the
month's expenses, because cash movements are not expenses.

Only an expense marked as cash SHALL affect the drawer. A blank category, a
present-but-blank note, a zero-or-negative amount and a future business date
SHALL be refused by the database.

#### Scenario: A cash expense reaches the drawer

- **WHEN** an expense is recorded as paid in cash for an outlet and business date
- **THEN** it is subtracted from that outlet's expected cash for that date and included in that month's expenses

#### Scenario: A non-cash expense does not reach the drawer

- **WHEN** an expense is recorded as not paid in cash
- **THEN** that day's expected cash is unaffected while the month's expenses still include it

#### Scenario: A capital purchase paid from the drawer keeps the drawer honest

- **WHEN** equipment is bought with cash from the drawer
- **THEN** it is recorded as cash taken out with its reason rather than as an expense, expected cash falls by that amount so the count still reconciles, and the month's expenses do not include it

#### Scenario: Commission and cash movements are warned against rather than absent

- **WHEN** a category naming aggregator commission, cash banked or an owner drawing is typed
- **THEN** the surface warns where that figure belongs instead and still accepts the entry, because free text cannot be closed against a spelling

#### Scenario: Every expense says what it was for

- **WHEN** an expense is recorded
- **THEN** a category naming what the money was spent on is stored with it, and the day's expense list and the month's expenses by category both show it

#### Scenario: An expense without a category is refused

- **WHEN** an expense with a missing, blank or whitespace-only category is submitted, including by a hand-crafted request
- **THEN** the database refuses the write and no expense row is created

#### Scenario: An expense without a note is accepted

- **WHEN** an expense is recorded with a category and an amount and no note
- **THEN** it is stored, and the day's expense list and the month's breakdown both show it under its category

#### Scenario: A blank note is refused while an absent one is not

- **WHEN** an expense carrying a note that is present but blank or whitespace-only is submitted by a hand-crafted request
- **THEN** the database refuses the write, while the same expense with no note at all is accepted

#### Scenario: An invalid expense is refused

- **WHEN** an expense with a blank category, a zero or negative amount, or a future business date is submitted by a hand-crafted request
- **THEN** the database refuses the write

### Requirement: A month reads as revenue by channel, aggregator revenue net of commission, and cash-basis profit that names its basis

For a chosen outlet and month the surface SHALL show gross revenue for each of
the four channels, aggregator revenue computed per day from that day's own
stored commission rate, expenses totalled by category, and an estimated profit.

Expenses SHALL be totalled by the **normalised category text stored on each
row**, so that two rows whose categories differ only in capitalisation or
spacing total as one line rather than as two.

Net revenue SHALL be cash revenue plus UPI revenue plus, for each aggregator
and each day, that day's stated revenue reduced by that day's own stored
commission rate. A single rate SHALL NOT be applied across a month whose days
carry different rates.

The profit figure SHALL be computed as net revenue minus every recorded expense,
and SHALL state in words beside it that it is a cash-basis operating estimate, as
`profit-estimates` requires of any profit figure. It SHALL be described as an
operating figure because capital purchases are deliberately not recorded here, so
it answers whether the outlet's trading covered its running costs and not where
every rupee went. Consumption-basis profit SHALL NOT be offered, because no stock
valuation is recorded. Aggregator commission SHALL NOT appear as an expense,
since it is already netted from revenue.

All arithmetic SHALL be performed in integer paise, and a commission reduction
SHALL round to the nearest paisa by a single stated rule so that a month's
figure is reproducible.

#### Scenario: Aggregator revenue is netted per day

- **WHEN** a month contains days whose Zomato commission rates differ
- **THEN** each day is reduced by its own stored rate and the month's net Zomato revenue is the sum of those per-day results

#### Scenario: Two spellings of one category total as one line

- **WHEN** a month contains expenses whose categories differ only in capitalisation or in surrounding or repeated whitespace
- **THEN** they are totalled as a single line in the month's breakdown rather than as separate categories

#### Scenario: The basis is named

- **WHEN** the month's estimated profit is rendered
- **THEN** the words identifying it as a cash-basis estimate appear beside the figure, and no consumption-basis figure is offered

#### Scenario: The estimate is named as an operating figure

- **WHEN** the month's estimated profit is rendered
- **THEN** it is stated as a cash-basis operating estimate, so that a reader is not led to believe it accounts for equipment or other capital spending

#### Scenario: No expense is silently excluded

- **WHEN** the month's profit estimate is computed
- **THEN** every recorded expense is subtracted, with no category or marker quietly left out, so the figure reconciles exactly against the month's expenses by category

#### Scenario: Commission is never also an expense

- **WHEN** the month's expenses by category are totalled
- **THEN** no aggregator commission is included, because it is netted from revenue instead

#### Scenario: Both outlets are read separately

- **WHEN** a month is read for one outlet
- **THEN** its figures include that outlet's rows only, and the other outlet's revenue and expenses are absent

#### Scenario: A month with no rows

- **WHEN** a month and outlet with no recorded days is opened
- **THEN** the surface states that nothing is recorded rather than showing zero as though it were a measured result

## ADDED Requirements

### Requirement: The rows recorded before categories were free text keep every word already typed into them

The conversion to free-text categories SHALL promote each already-recorded
expense's "what was it for" text to its category, and SHALL discard the
fixed-list value. The nine rows recorded between 2026-08-01 and 2026-08-06 carry
a fixed-list category that is identical on all of them and holds no information,
while the required text beside it holds the real one.

The suggestion list SHALL be seeded with the distinct promoted values, so that a
category already in nightly use is offered rather than retyped.

The conversion SHALL assert its own outcome inside the transaction that performs
it: the number of rows converted, that no row is left with a blank category, and
the number of categories seeded. A conversion that moves fewer rows than exist
SHALL fail and change nothing, because a partial conversion of the only record of
a month's trading is worse than a refused one.

#### Scenario: Every recorded row keeps its words

- **WHEN** the conversion runs against the recorded rows
- **THEN** each row's category is the text it previously carried as its description, normalised, and no row loses a word that was typed into it

#### Scenario: The suggestion list starts populated

- **WHEN** the conversion completes
- **THEN** the suggestion list holds one entry per distinct promoted category, and recording the next expense offers them

#### Scenario: A partial conversion is refused

- **WHEN** the conversion would leave any existing row with a blank category, or would convert fewer rows than exist
- **THEN** the transaction fails and every row is left exactly as it was
