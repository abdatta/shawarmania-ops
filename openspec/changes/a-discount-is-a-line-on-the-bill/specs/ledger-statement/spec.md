## ADDED Requirements

### Requirement: The day reports what it gave away

A trading day SHALL report the total discount given on that day's bills, as its
own section, derived on read like every other figure on the day.

The day SHALL state that its sales figures are net of that amount, so that a
reader comparing two days is never left to infer why one is lower.

A day on which nothing was discounted SHALL say so rather than being omitted, for
the same reason a channel that reported nothing is named rather than omitted.

#### Scenario: A day carrying discounts

- **WHEN** a day's bills carry discounts
- **THEN** the day reports the total given away, and says its sales are net of it

#### Scenario: A day carrying none

- **WHEN** no bill that day carried a discount
- **THEN** the section says nothing was discounted, rather than being absent

#### Scenario: A voided bill

- **WHEN** a discounted bill on that day is voided
- **THEN** its discount stops counting towards the day's total, as its sales do

### Requirement: The month reports what it gave away, beside what it earned

The month SHALL report the total discount given across its bills as its own
section, and SHALL state that its revenue figures are net of it.

The figure SHALL be reported for the month even where the month's other
qualifications apply, and SHALL carry the same qualification as the revenue it
sits beside where any of that revenue is a ceiling.

#### Scenario: A month running a discount

- **WHEN** a month's bills carry discounts
- **THEN** the month reports the total given away beside its revenue, and names
  the revenue as net of it

#### Scenario: Revenue is already a ceiling

- **WHEN** the month's revenue is qualified as a ceiling because a commission is
  undetermined
- **THEN** the discount figure carries the same qualification rather than reading
  as settled

#### Scenario: A month with no billed date

- **WHEN** a month has no recorded sales at all
- **THEN** it says so, and offers no discount figure rather than nought
