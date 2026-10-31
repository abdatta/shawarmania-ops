## ADDED Requirements

### Requirement: A fixed-cost payment carries a Fixed chip that no typed expense can

For the owner and a Franchise Admin, an expense linked to a fixed cost SHALL read
on the expenses surface as the fixed cost's name with its category in brackets,
or the name alone where the two are one word, with a **Fixed** chip drawn as the
Cash chip is, and the day it was paid where that differs from the day it counts
in. The reading SHALL come from the link, which only the pay action writes, and
not from the expense's category or note.

A Biller, an Employee and the counter SHALL read a fixed-cost payment made in
cash as any cash expense, without the chip, and SHALL make no request for links.

A fixed-cost payment SHALL be corrected and withdrawn on the expenses surface as
any expense is.

#### Scenario: The owner reads the day

- **WHEN** the owner opens 31 October's expenses and Nayan's salary counts on that day
- **THEN** it reads *Nayan (Salary)* with **Fixed** and *paid 2 Nov*

#### Scenario: A typed lookalike

- **WHEN** an expense is recorded with category *Salary* and note *Nayan [fixed]*
- **THEN** it reads as typed, with no Fixed chip

#### Scenario: The counter

- **WHEN** the counter lists the day's cash expenses and one is a fixed-cost payment in cash
- **THEN** it reads as any cash expense and the counter's requests are unchanged
