## ADDED Requirements

### Requirement: A fixed cost carries over every month, prorated by calendar days

An outlet SHALL hold fixed costs, each with a name, a category of **Salary**,
**Rent**, **Utility** or **Other**, a monthly amount in integer paise, a start
date, an optional stop date and an optional note. A fixed cost SHALL NOT be
linked to an account.

For each calendar month that has at least one date between its start and stop
dates inclusive, a fixed cost SHALL cost the monthly amount in effect for that
month, multiplied by those dates and divided by the days in the month, rounded
down to the paisa, unless that month has been settled, in which case it SHALL
cost the latest unvoided settlement. No month SHALL be written by a scheduled
job; every month's cost SHALL be derived on read.

A changed monthly amount SHALL apply from a chosen month on and SHALL NOT change
an earlier month. A fixed cost SHALL never be deleted: it stops, and a
settlement is voided rather than removed.

#### Scenario: A whole month carries over

- **WHEN** a ₹10,000 salary started on 1 October and nothing was entered in November
- **THEN** November costs ₹10,000

#### Scenario: Joining part-way through a month

- **WHEN** a ₹10,000 salary starts on 20 November
- **THEN** November costs ₹3,666.66 (11 of 30 days) and December ₹10,000

#### Scenario: Leaving part-way through a month

- **WHEN** a ₹31,000 salary stops on 12 December
- **THEN** December costs ₹12,000 and January costs nothing and is not listed

#### Scenario: A raise from next month

- **WHEN** the amount is changed to ₹12,000 from December during November
- **THEN** November still costs ₹10,000 and December ₹12,000

### Requirement: A fixed cost's balance runs across months, and a payment pays the oldest month owed

A fixed cost's balance SHALL be the sum of every month's cost from its start
through the current month in full, less every effective payment counted in a
month up to then. It SHALL read **To pay** with the amount above zero, **All
clear** at zero, and **Paid ahead** with the amount's magnitude below zero, and
SHALL never be shown as a negative number.

No payment SHALL store a month. Which month a payment paid SHALL be derived
first in first out, oldest month first, in the order payments count in. A month
SHALL be **unpaid** once it has ended with part of its cost not covered.

A payment SHALL count only while its expense is effective, at the expense's
current amount, so that correcting or withdrawing the expense corrects the
balance.

#### Scenario: An advance across two months

- **WHEN** a ₹10,000 salary is paid ₹15,000 in October as paid ahead
- **THEN** October reads paid, the balance reads **Paid ahead ₹5,000**, and on 1
  November it reads **To pay ₹5,000**

#### Scenario: An advance across three months

- **WHEN** a ₹10,000 salary is paid ₹30,000 in October as paid ahead
- **THEN** October, November and December are covered and nothing is owed until
  January

#### Scenario: A withdrawn payment

- **WHEN** a payment's expense is withdrawn on the Expenses page
- **THEN** the balance rises by its amount and the months it covered are owed again

### Requirement: Paying a different amount offers three choices before it saves

A payment SHALL record the amount, the date it was paid, the date it counts in,
whether it was paid from the drawer, and a note. When the amount differs from
what is owed through the month it counts in, the payment SHALL NOT save until
one of three choices is taken, and the server SHALL recompute the choice's
effect and refuse a payment whose effect it computes differently.

For less than owed: **keep the rest pending** (the default, recording nothing
more), **drop the rest just this month** (settling the month at what it has
covered), or **make the amount the new monthly amount** (that settlement, and the
amount from the next month). For more than owed: **paid ahead** (recording nothing
more), **extra just this month** (settling the month at its cost plus the
excess), or **the new monthly amount** (that settlement, and the amount from the
next month). Paid ahead SHALL be the default for Salary and Rent, extra for
Utility and Other. The new-monthly-amount choice SHALL NOT be offered where the
month is prorated. Paying exactly what is owed SHALL ask nothing.

#### Scenario: Paid less, the rest kept

- **WHEN** ₹8,000 is paid against ₹10,000 owed with the default choice
- **THEN** the balance reads **To pay ₹2,000** and the month stays unpaid after it ends

#### Scenario: Paid less, dropped

- **WHEN** ₹8,000 is paid against ₹10,000 owed and the rest is dropped
- **THEN** the month costs ₹8,000, the balance reads **All clear**, and the next month costs ₹10,000

#### Scenario: Paid more, a new monthly amount

- **WHEN** ₹12,000 is paid against ₹10,000 owed as the new monthly amount
- **THEN** the month costs ₹12,000 and every later month costs ₹12,000

#### Scenario: A prorated month withholds the new amount

- **WHEN** a payment is made in a month the fixed cost started part-way through
- **THEN** the choices offered are keep pending and drop, or paid ahead and extra

### Requirement: A payment for an earlier month counts in that month, and keeps the day it was paid

When an earlier month still has a balance and the payment is not from the drawer,
the payment SHALL count, by default, on the last day of the latest such month,
and SHALL offer to count on the day paid instead. A payment from the drawer SHALL
count on the day it was paid. The day paid SHALL be stored apart from the day it
counts in, and both SHALL be shown wherever the payment is listed with its fixed
cost.

#### Scenario: October's salary paid on 2 November

- **WHEN** a salary with October unpaid is paid by transfer on 2 November
- **THEN** it counts on 31 October, October's P&L includes it, and its listing reads
  *paid 2 Nov · counted in October*

#### Scenario: Garbage paid from the drawer

- **WHEN** a fixed cost with October unpaid is paid in cash on 2 November
- **THEN** it counts on 2 November and the drawer's expected cash falls by it then

### Requirement: A payment is an expense that only the pay action can mark as fixed

A payment SHALL be recorded as an expense row, written under the same policy,
guard and category capture as an expense the owner records, with the category's
word as its category and the fixed cost's name as its description. Paid from the
drawer, it SHALL reduce the drawer's expected cash as every cash expense does.

What marks the expense as a fixed-cost payment SHALL be its link to the fixed
cost, which only the pay action writes. No text in an expense SHALL make it read
as one.

#### Scenario: A typed lookalike

- **WHEN** someone records an ordinary expense with *[fixed]* in its category and note
- **THEN** it reads as typed, with no Fixed chip, and no fixed cost's balance changes

### Requirement: An unpaid month is named until it is paid or dropped

Once a month has ended, the number of fixed costs with that month unpaid SHALL
be shown under Needs attention for the owner and the outlet's manager, naming the
month, and as the Fixed costs entry's badge, and SHALL clear when each is paid
or dropped.

#### Scenario: Salaries not recorded by the 1st

- **WHEN** it is 1 November and three fixed costs have October unpaid
- **THEN** Needs attention reads *Fixed costs: 3 unpaid from October*, opening the list

#### Scenario: Paid on the 2nd

- **WHEN** the three are paid on 2 November, counted in October
- **THEN** the line and the badge disappear

### Requirement: Only the owner and the outlet's manager reach fixed costs

Every fixed-cost table and read SHALL admit the owner and the Franchise Admin
assigned to the outlet and SHALL refuse every other reader, including a Biller,
an Employee, a counter shift, another outlet's Franchise Admin with a
hand-crafted request, a deactivated account and an anonymous one. The pay action
SHALL refuse anyone else before any expense is written. Nothing SHALL be deleted.

#### Scenario: Another outlet's manager

- **WHEN** a Franchise Admin requests another outlet's fixed costs directly
- **THEN** the request is refused, not answered with an empty list

#### Scenario: A Biller calls the pay action

- **WHEN** a Biller calls the pay action for their own outlet's fixed cost, in cash
- **THEN** it is refused and no expense is recorded
