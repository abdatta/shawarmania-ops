# Delta: manual-ledger

## ADDED Requirements

### Requirement: The owner and a manager reach any business date on the expenses surface, and correct what they find there

An account holding a live Super Admin assignment, and an account holding a live
Franchise Admin assignment at the outlet the surface is about, SHALL reach the
expenses surface opened to **one business date at a time**, with a control that
steps to the previous date, steps to the next, and opens the platform calendar
on the date itself. Forward stepping and the calendar SHALL both stop at that
outlet's current business date, resolved through its own cutover, because the
guard refuses a future business date and a control offering one offers a
failure. The calendar SHALL offer a floor no nearer than one year before that
date; the steps SHALL continue past it, because the floor is a property of the
picker and not of the record, and no read SHALL be bounded by date.

The surface SHALL record a newly added expense against **the business date on
screen**, not against the current business date, and SHALL offer that action on a
date with no expenses recorded against it. Reaching a past day in order to record
what was missed from it is the reason this control exists.

Such an account SHALL be able to correct and withdraw **any** expense on the date
it reaches, whoever recorded it, at every outlet the assignment above names. The
surface SHALL NOT hide a correction the database would permit, and SHALL NOT
offer one it would refuse.

This SHALL be the same surface, the same list component and the same entry form
that outlet staff reach, differing only in which day control it renders, how many
business dates it requests, and whether a row offers its actions. It SHALL NOT
show revenue by any channel, opening cash, cash movements, the counted drawer,
any commission rate, any difference, or any monthly figure to any reader,
because the distinction between the two shapes is one of reach and never one of
financial truth.

A day reached this way SHALL state what was spent against it and how much of
that came from the drawer. A withdrawn expense SHALL count toward neither.

#### Scenario: The owner reaches a day three weeks back

- **WHEN** a Super Admin opens the expenses surface and steps or picks back to a business date three weeks earlier
- **THEN** that date's expenses are listed, each naming its recorder, with the day's total and its cash portion stated

#### Scenario: A manager corrects a staff member's row on a past date

- **WHEN** a Franchise Admin reaches a past business date at an outlet they are assigned to and corrects an expense recorded there by an Employee
- **THEN** the correction is accepted, and the row names the Employee as its recorder and the Franchise Admin as having corrected it

#### Scenario: An expense is added to the day on screen

- **WHEN** the owner reaches a past business date and records an expense from that day's surface
- **THEN** the expense is written against the date on screen rather than the current business date

#### Scenario: A day with nothing recorded still takes an entry

- **WHEN** the owner reaches a past business date with no expenses recorded against it
- **THEN** the surface states that nothing was recorded for that day and still offers to record one

#### Scenario: The control refuses tomorrow

- **WHEN** the shown business date is the outlet's current business date
- **THEN** the forward step is unavailable and the calendar offers no later date

#### Scenario: Staff reach the same surface without the same reach

- **WHEN** a Biller or an Employee opens the expenses surface
- **THEN** no day control is offered, the two most recent business days are listed, and no expense recorded by somebody else offers a correction or a withdrawal
