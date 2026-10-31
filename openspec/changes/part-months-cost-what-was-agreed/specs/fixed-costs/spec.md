## ADDED Requirements

### Requirement: A part month costs the figure agreed for it

While `agreed-part-months` is on, a fixed cost that starts or stops part-way
through a month SHALL cost, for that month, the figure agreed for it, recorded
as that month's settlement when the start or stop is saved. Adding or editing a
fixed cost to start on a day other than the 1st SHALL require what that month
comes to, in whole rupees. No screen SHALL show a count of days for a fixed
cost. Pro-rata P&L SHALL charge a part month's agreed figure from its start day
and by its stop day.

#### Scenario: Joining part-way through a month

- **WHEN** a ₹10,000 salary is added to start on 20 November, with November agreed at ₹3,500
- **THEN** November costs ₹3,500 and December ₹10,000

#### Scenario: A stopped month is charged in full by its last day

- **WHEN** a cost stops on 28 October, closed at ₹4,000 with ₹2,000 paid, and Pro-rata P&L is read on the 29th
- **THEN** it charges the unpaid ₹2,000 in full

### Requirement: Stopping asks for the final payment

While `agreed-part-months` is on, stopping a fixed cost SHALL ask for the final
payment in whole rupees, starting empty, on top of what payments already leave
for the stop month once every earlier month is paid. The stop month SHALL then
cost that amount plus the final payment. Paid now SHALL record the final
payment as a payment on the last day, or today if the last day is later, in the
same transaction; Paying later SHALL record none. A stopped cost whose stop
month is a part month with no agreed figure SHALL offer to close that month the
same way.

#### Scenario: Jayanta Da's closing

- **WHEN** a ₹6,000 salary with ₹2,000 paid on 21 October is stopped on 28 October with a final payment of ₹2,000, paid now
- **THEN** a ₹2,000 payment is recorded on 28 October and October costs ₹4,000, all paid

#### Scenario: Paying later

- **WHEN** the same cost is stopped with a final payment of ₹2,000, paying later
- **THEN** October costs ₹4,000 and reads ₹2,000 of ₹4,000 paid

#### Scenario: Nothing more

- **WHEN** it is stopped with Nothing more
- **THEN** October costs ₹2,000, what was paid

### Requirement: A stopped cost stays in its place for the month it stopped in

While `agreed-part-months` is on, the Fixed list SHALL keep a stopped fixed cost
in its place while its stop month is the current month or while it owes money,
saying when it stopped. Once nothing is owed it SHALL be shown as done, greyed
with a red cross and no Pay. Otherwise it SHALL leave the list for one line at
the foot that shows the stopped costs when tapped.

#### Scenario: Next month

- **WHEN** a cost stopped and fully paid in October is read in November
- **THEN** it is not in the list, and the foot reads Stopped · 1 · Show
