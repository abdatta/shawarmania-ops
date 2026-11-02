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

### Requirement: An expense's category is chosen from the owners' list

While `expense-category-list` is on, the expense form SHALL offer the category as
tiles from a business-wide list the owners keep, in their order, instead of the
typed field. A choice marked as asking what it was for SHALL make the note
required, and the form SHALL refuse to save without it. Choices marked for
managers and owners SHALL NOT be offered to an Employee, a Biller or the counter
tablet. Editing an expense whose category is not on the list SHALL offer its
recorded name as a chosen tile. The database SHALL store the chosen name as the
expense's category text, as the typed field does, and SHALL NOT refuse a name
because it is off the list.

#### Scenario: Staff pick a category

- **WHEN** an Employee opens the expense form with `expense-category-list` on
- **THEN** the categories are tiles from the owners' list, without the managers-and-owners choices, and no tile is chosen

#### Scenario: Other asks what it was for

- **WHEN** someone chooses Other and saves with the note empty
- **THEN** the form refuses with "Say what it was for." and nothing is recorded

#### Scenario: An old expense keeps its name

- **WHEN** a manager edits the amount of an expense filed as "Milk", which is not on the list
- **THEN** "Milk" is offered as a chosen tile and saving keeps it

### Requirement: Only the owners change the category list

The list SHALL be changed only by an owner: adding, editing, reordering and
removing a choice. Renaming a choice SHALL move the expenses recorded under its
old name and log the operation as a rename. Removing a choice SHALL leave
recorded expenses unchanged.

#### Scenario: A manager cannot change the list

- **WHEN** a Franchise Admin sends a hand-crafted request to add a choice
- **THEN** the database refuses it and the list is unchanged
