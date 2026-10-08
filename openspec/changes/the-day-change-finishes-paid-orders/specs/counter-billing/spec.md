## RENAMED Requirements

- FROM: `### Requirement: Finish Day refuses while food is owed on a paid order, and otherwise closes the window`
- TO: `### Requirement: Finish Day names food owed on a paid order, and closes the window`

## MODIFIED Requirements

### Requirement: Finish Day names food owed on a paid order, and closes the window

Finish Day SHALL name every order at this tablet's business date that is **paid and
not marked prepared**, in the biller's words and separately from open orders and
from recent payments, as an **advisory** stating that it will be marked prepared at
the outlet's business-day cutover, with that cutover's time shown. It SHALL NOT
refuse the day close on that account. Finishing the day SHALL NOT mark such an
order prepared: the food may still be cooking, and the order SHALL remain on the
rail until a Prepared tick or the cutover, whichever comes first.

Finishing the day SHALL otherwise proceed immediately, **ending any open payment
edit window early** rather than refusing until it elapses. No guard SHALL refuse
the day close on the grounds that a payment is still editable. After the day is
finished, taking a payment back, cancelling after payment and correcting a tender
SHALL all be refused by the database, and that refusal SHALL be proved by a
hand-crafted request rather than assumed from the absence of a live shift.

An order that is open and unpaid SHALL continue to block the day close.

#### Scenario: A paying customer is still owed food

- **WHEN** an operator opens Finish Day with one order paid and not marked prepared, at an outlet whose cutover is 04:00
- **THEN** the sheet names that order as paid but not marked prepared, says it will be marked prepared at 04:00, and offers to finish

#### Scenario: Finishing leaves the food owed visible

- **WHEN** the operator finishes the day with that order still unprepared
- **THEN** the day closes, the order is still unprepared, and it remains on every rail at the outlet until it is ticked or the cutover passes

#### Scenario: An unpaid order still holds the day open

- **WHEN** an operator opens Finish Day with one order open and unpaid
- **THEN** the sheet refuses and names it, and the database refuses a hand-crafted day close for that date

#### Scenario: A recent payment does not hold the day open

- **WHEN** an operator finishes the day one minute after taking a payment on a finished ticket
- **THEN** the day closes at once and that payment's edit window ends with it

#### Scenario: Nothing moves after the day is closed

- **WHEN** a hand-crafted take-back, cancel-after-paid or tender correction is submitted for a bill whose day has been finished, including one whose order is still unprepared
- **THEN** the database refuses it
