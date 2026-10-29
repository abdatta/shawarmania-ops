## ADDED Requirements

### Requirement: An expense list reads by day and marks the reader's own rows

While `refreshed-staff-screens` is on, wherever an expense list shows more than one
business date, its rows SHALL be grouped under the day (**Today**,
**Yesterday**, or the date) instead of repeating the date on every row. A list
of one business date SHALL be unchanged. Every row recorded by the reader SHALL
carry a **You** tag. The Cash label SHALL remain on every cash expense. No
sentence SHALL sit under the Expenses heading.

#### Scenario: Staff read two days

- **WHEN** an Employee opens Expenses with expenses recorded today and yesterday
- **THEN** the rows sit under Today and Yesterday headings, each cash row still carries its Cash label, and the rows the Employee recorded carry You

#### Scenario: The counter reads the same list

- **WHEN** the counter tablet shows its expense list
- **THEN** it carries the You tag and the Cash label in the same way

### Requirement: Adding an expense asks the amount first

While `refreshed-staff-screens` is on, the expense form SHALL ask the amount first, then
the category in the existing typed field with its suggestions, then the
payment method
where the reader chooses one, then the optional note, whose example SHALL read
*What was it for?*. The form SHALL still ask for no more than four fields, and
the method SHALL still start unchosen for the owner and a manager.

#### Scenario: Staff add an expense

- **WHEN** a Biller, an Employee or the counter tablet opens the expense form
- **THEN** the amount is the first field, the category is the typed field with its suggestions, and the note's example reads "What was it for?"

