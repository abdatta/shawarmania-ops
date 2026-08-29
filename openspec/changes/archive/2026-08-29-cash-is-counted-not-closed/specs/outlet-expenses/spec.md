## MODIFIED Requirements

### Requirement: Recording an expense takes four fields and no more

Recording an expense SHALL ask for a category, an amount, a payment method and
an optional note, and no more. Every expense SHALL additionally carry an
**occurrence instant**, which SHALL be supplied by the system rather than typed:
it defaults to the moment of recording and is exposed for correction only where
the person chooses to say the spend happened earlier. It SHALL NOT become a
required fifth field.

An expense recorded without an explicit occurrence instant SHALL be treated as
having occurred when it was recorded.

#### Scenario: An ordinary expense

- **WHEN** a person records a category, an amount and a method
- **THEN** the expense is accepted and its occurrence instant is the moment of recording

#### Scenario: An expense that happened earlier

- **WHEN** a person states that a cash spend happened earlier in the evening
- **THEN** the stated instant is stored and the recording instant is retained alongside it

#### Scenario: The form is not lengthened

- **WHEN** the expense form is rendered
- **THEN** it presents four fields, with the occurrence instant reachable rather than demanded

### Requirement: Only cash expenses move the day's cash position

Only an expense whose payment method is cash SHALL affect any drawer figure. A
non-cash expense SHALL count toward the day's and the month's expense totals and
SHALL move no drawer balance.

A cash expense SHALL belong to a drawer interval by its occurrence instant,
falling back to its recording instant where none was stated, so that a spend
before a count and a spend after one land on opposite sides of that count.

A cash expense whose occurrence instant falls inside an interval that has already
been observed SHALL raise the drawer's reconciliation exception rather than
altering the observation.

#### Scenario: A UPI expense leaves the drawer alone

- **WHEN** a UPI expense is recorded
- **THEN** the expenses total rises and no drawer balance changes

#### Scenario: A cash expense before and after a count

- **WHEN** one cash expense occurs at 18:10 and another at 23:00, with a count at 22:00
- **THEN** the first is inside that count's interval and the second is not

#### Scenario: A cash expense backdated into an observed interval

- **WHEN** a cash expense is recorded with an occurrence instant before the most recent observation
- **THEN** the observation is unchanged and an exception reports the expense against it
