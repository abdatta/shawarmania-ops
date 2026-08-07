## MODIFIED Requirements

### Requirement: Recording an expense takes four fields and no more

Adding an expense SHALL ask for a category, an amount, a payment method and an
optional description, and nothing else. The amount SHALL be entered in rupees
and converted to integer paise at the boundary.

The category SHALL be free text drawn from the business-wide growing list
defined by `expense-categories`, rather than chosen from a fixed set of values.
It SHALL be offered as suggestions the moment the field is focused, SHALL filter
as it is typed, and SHALL accept a word not yet in the list, which joins the
suggestions from the next entry onward. It SHALL be required and SHALL be
refused when blank or whitespace-only, by the database and not only by the form.

#### Scenario: Recording a cash expense

- **WHEN** a Franchise Admin records an expense with a category, an amount in rupees and the cash method
- **THEN** the expense is added to the day's list, and the amount passed to the data layer is integer paise

#### Scenario: An expense with no amount

- **WHEN** an expense is submitted with a blank or non-numeric amount
- **THEN** the write is refused with a sentence naming the amount, and nothing is recorded

#### Scenario: The category field suggests before it is typed into

- **WHEN** the category field is focused
- **THEN** existing categories are offered as suggestions, and typing filters them

#### Scenario: A category not yet in the list is accepted

- **WHEN** an expense is recorded with a category that does not yet exist
- **THEN** the expense is stored with it and it is offered as a suggestion from the next entry onward

#### Scenario: An expense with no category

- **WHEN** an expense is submitted with a blank or whitespace-only category, including by a hand-crafted request
- **THEN** the database refuses the write and nothing is recorded

### Requirement: The expenses surface shows one business day at a time

The expenses surface SHALL list the expenses recorded against a single
business date for one outlet, most recent first, each showing its category,
amount, payment method and description. The category SHALL be shown as the text
stored on the row rather than as a label looked up from the live suggestion
list, so that renaming or retiring a category cannot re-label a recorded
expense. The business date SHALL be shown as a date and SHALL be selectable,
never derived from the device clock at read time.

#### Scenario: Reading a day's expenses

- **WHEN** a Franchise Admin opens the expenses surface
- **THEN** the expenses for the shown business date are listed with category, amount, payment method and description

#### Scenario: A day with no expenses

- **WHEN** the shown business date has no expenses recorded
- **THEN** an empty state states what to record, rather than reporting no data

#### Scenario: A retired category still reads on the rows that used it

- **WHEN** a category is retired from the suggestion list after expenses were recorded under it
- **THEN** those expenses still show that category on the day's list, unchanged
