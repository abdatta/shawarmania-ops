## MODIFIED Requirements

### Requirement: A customer is identified by their phone, and their name is recorded with it

Both customer snapshots SHALL remain nullable, and the database SHALL never
require either: a bill or order carrying no customer at all is valid, and nothing
downstream may assume one.

The phone is the identity that resolves a returning customer and creates a
customer record. The name is that customer's own name, given with their number
and snapshotted onto the order and bill as it stood at the sale.

A name SHALL be recorded only for a customer identified by phone. The counter
SHALL NOT request or store a name for an order whose customer gave no number;
the preparation pipeline and shift list SHALL identify it by its order number.
Previously captured historical names SHALL remain intact.

Customer entry SHALL be optional when placing or editing an order. The counter
SHALL NOT require identification or Skip before Order or Save changes. At outlets
collecting customer details, payment SHALL ask for a number when none is attached
and offer one-tap Skip before tender. An attached number SHALL be shown and kept.
Collection off SHALL hide entry and bypass the payment prompt. No database
constraint SHALL be added for this UI checkpoint.

A phone SHALL be a complete Indian mobile number canonicalised by the same rule
the database uses, or resolve and create nothing. The counter SHALL NOT report a
number as malformed while it is still being typed.

#### Scenario: A bill with no customer reaches the database
- **WHEN** a bill or order is written with both customer fields null
- **THEN** the database accepts it without a customer requirement

#### Scenario: An order is rung for a customer who gave no number
- **WHEN** the biller places an order without entering a customer or pressing Skip
- **THEN** the order carries no customer name, phone or id, no customer record is created or matched, and its order number identifies it

#### Scenario: An identified customer is snapshotted whole
- **WHEN** the biller identifies a customer and the order is accepted
- **THEN** the order and bill carry the customer id, canonical phone and name, not the id alone

#### Scenario: The saved profile is never rewritten from the till
- **WHEN** a name differing from the matched customer's saved name is given at the counter
- **THEN** that name is snapshotted onto this order and bill only, and the saved global profile is unchanged

### Requirement: The composer supports immediate payment and saving an order

The billing composer SHALL offer primary Order and secondary Paid when at least
one line exists, required service choices are answered and local acceptance is
not busy. Customer entry SHALL NOT govern either action's availability. The same
rule SHALL permit Save changes on an anonymous order.

Order SHALL create a tablet-owned order without assigning a bill number and
clear the composer only after the adapter accepts it. Paid SHALL open checkout,
asking for a missing number where collection is on, then show customer benefits,
the final total and tender. Exact payment allocation SHALL be required for
settlement. Both customer snapshots SHALL remain nullable.

The composer SHALL offer Add discount below the lines in the bill column, and
both paths SHALL carry the discount, its basis and rounding.

#### Scenario: Customer pays upfront
- **WHEN** the operator opens Paid, supplies or skips a missing number where required, allocates the exact total and confirms
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: A discount is applied before the order leaves
- **WHEN** the operator adds a discount and chooses Order or Paid
- **THEN** the accepted command carries that discount, its basis and the bill's rounding

#### Scenario: Food has to be made first
- **WHEN** the operator chooses Order without touching customer entry
- **THEN** the order appears at the newest end of the pipeline with its order number and no bill number

#### Scenario: The biller has not decided yet
- **WHEN** the current bill has items, required service choices are answered and customer entry is untouched
- **THEN** Order and Paid are available without Skip; payment asks for the missing number when collection is on

#### Scenario: The biller skipped
- **WHEN** the biller has skipped identification while ordering
- **THEN** both actions remain available and payment still asks if no number is attached and collection is on

#### Scenario: Required service choice is missing
- **WHEN** the outlet requires a service or table decision that has not been answered
- **THEN** Order, Save changes and Paid remain unavailable regardless of customer entry

#### Scenario: Empty or busy composer
- **WHEN** no line exists or a local acceptance is in progress
- **THEN** Order, Save changes and Paid remain unavailable

### Requirement: The customer is identified from one control that opens a keypad

At outlets collecting details, the composer SHALL present optional customer
identification as one control, rather than separate name and phone inputs,
reading in three states: nothing chosen, a customer chosen or deliberately
skipped. It SHALL show a chosen customer's name and canonical phone. There SHALL
be no separate action beside it; tapping SHALL reopen the dialog, and accepting
a different number or skipping there SHALL revise the choice.

Where the chosen customer holds membership, the control SHALL carry the member
mark, and the dialog SHALL carry it on a resolved match or partial-number
suggestion before acceptance.

The dialog SHALL carry an on-screen numeric keypad in the tender-capture idiom.
It SHALL NOT offer a search button; entry alone SHALL suffice. The composer
SHALL NOT add a sentence instructing the biller to enter a customer or disable
ordering to force use of the control.

#### Scenario: The biller opens the control
- **WHEN** the customer control is tapped
- **THEN** a dialog opens with a numeric keypad and an empty number readout

#### Scenario: A member is resolved in the dialog
- **WHEN** a complete phone matches a customer holding membership
- **THEN** the match carries the member mark before acceptance, without a date, actor or figure

#### Scenario: A member is suggested from a partial number
- **WHEN** a partial number suggests a member this outlet has served
- **THEN** the suggestion carries the member mark, without a date, actor or figure

#### Scenario: A chosen customer is changed
- **WHEN** the biller taps the chosen customer's control
- **THEN** the dialog reopens, and the choice changes only on accepting another number or skipping

#### Scenario: The number is entered without a system keyboard
- **WHEN** the biller enters a number in the dialog
- **THEN** every digit can be entered from its on-screen pad without a device keyboard
