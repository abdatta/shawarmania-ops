## RENAMED Requirements

- FROM: `### Requirement: Customer identity is optional to the database and prompted by the counter`
- TO: `### Requirement: A customer is identified by their phone, and their name is recorded with it`

- FROM: `### Requirement: Exact phone lookup offers form-local autofill`
- TO: `### Requirement: A complete number resolves itself inside the customer dialog`

## MODIFIED Requirements

### Requirement: A customer is identified by their phone, and their name is recorded with it

Both customer snapshots SHALL remain nullable, and the **database** SHALL never
require either: a bill or order carrying no customer at all is valid, and nothing
downstream may assume one.

The **phone is the identity** — it is what resolves a returning customer and what
a customer record is created against. The **name is that customer's own name**,
given along with their number and snapshotted onto the order and the bill as it
stood at the sale.

A name SHALL be recorded only for a customer identified by phone. The counter
SHALL NOT request or store a name for an order whose customer gave no number:
such an order is identified by its own order number, which is what the
preparation pipeline and the shift's bill list display for it.

The counter SHALL require that the biller has **made a decision** — identified a
customer, or deliberately skipped — before Order or Mark Paid. It SHALL NOT
require a phone, and SHALL NOT accept a name in place of one as identification.
This requirement SHALL exist only in the UI; no database constraint SHALL be
added for it.

A phone SHALL be a complete Indian mobile number canonicalised by the same rule
the database uses, or resolve and create nothing. The counter SHALL NOT report a
number as malformed while it is still being typed.

#### Scenario: A bill with no customer reaches the database
- **WHEN** a bill or order is written with both customer fields null
- **THEN** the database accepts it, because the requirement is the counter's habit and not the schema's promise

#### Scenario: An order is rung for a customer who gave no number
- **WHEN** the biller skips customer identification
- **THEN** the order carries no customer name, no phone and no customer id, no customer record is created or matched, and the order is identified by its order number

#### Scenario: An identified customer is snapshotted whole
- **WHEN** the biller identifies a customer and the order is accepted
- **THEN** the order and the bill carry the customer id, the canonical phone and the name, not the id alone

#### Scenario: The saved profile is never rewritten from the till
- **WHEN** a name differing from the matched customer's saved name is given at the counter
- **THEN** that name is snapshotted onto this order and bill only, and the saved global profile is unchanged

### Requirement: A complete number resolves itself inside the customer dialog

The counter SHALL request an exact customer match only when a complete valid
phone has been entered, and SHALL make at most one request per distinct complete
number rather than one per keystroke.

The dialog SHALL present the outcome without the biller asking for it: a match
SHALL show the saved name and offer to use it; a complete number with no match
SHALL offer to save it, asking for the customer's name, which is the one moment
a saved profile's name is set; an incomplete number SHALL show nothing at all.
Accepting a match SHALL affect only this order. A number saved this way SHALL be
created when the order or paid bill is accepted, and SHALL NOT block the sale.

A match served from the tablet's last successful read SHALL be distinguished from
one read live, and SHALL say that it will be checked again on sync.

A lookup that is refused, rate-limited or fails SHALL be presented to the biller
the same way a number with no match is presented, disclosing nothing about which
occurred.

#### Scenario: A saved customer is recognised
- **WHEN** a complete phone matches a saved customer
- **THEN** the dialog shows the saved name and the action offers to use it

#### Scenario: An unknown number is offered for saving
- **WHEN** a complete phone matches nobody
- **THEN** the dialog asks for the customer's name and will not save the number without one

#### Scenario: Nine digits say nothing
- **WHEN** fewer than ten digits have been entered
- **THEN** the dialog shows no match, no absence of a match, and no validation message

#### Scenario: The tablet is offline and remembers the number
- **WHEN** a complete phone matches the tablet's remembered customers while the network is unreachable
- **THEN** the match is offered, marked as read earlier, and stated to be subject to recheck on sync

#### Scenario: The lookup is rate-limited
- **WHEN** the lookup bound is exceeded or the caller is refused
- **THEN** the dialog reads exactly as it does for a number that matched nobody, and the sale continues

### Requirement: The composer supports immediate payment and saving an order

The billing composer SHALL offer primary Order and secondary Mark Paid once at
least one line exists and the biller has either identified a customer or skipped.
Order SHALL create a tablet-owned order without assigning a bill number and SHALL
clear the composer only after the adapter accepts it. Mark Paid SHALL open the
tender dialog and create a paid result after exact payment allocation. This
identification requirement SHALL exist only in the UI; the database SHALL keep
both snapshots nullable.

The composer SHALL offer an **Add discount** control, positioned below the lines
in the bill column, and both paths SHALL carry whatever discount results.

#### Scenario: Customer pays upfront
- **WHEN** an operator opens Mark Paid, allocates the exact total and confirms Mark Paid
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: A discount is applied before the order leaves
- **WHEN** an operator adds a discount and then chooses Order or Mark Paid
- **THEN** the accepted command carries that discount, its basis, and the bill's
  rounding

#### Scenario: Food has to be made first
- **WHEN** an operator chooses Order
- **THEN** the order appears at the newest end of the pipeline list with its order number and no bill number

#### Scenario: The biller has not decided yet
- **WHEN** the current bill has items and the customer control has not been used
- **THEN** Order and Mark Paid remain disabled, the control is the only thing that resolves it, and no database constraint is added

#### Scenario: The biller skipped
- **WHEN** the biller has skipped customer identification
- **THEN** both terminal actions become available

## ADDED Requirements

### Requirement: The customer is identified from one control that opens a keypad

The composer SHALL present customer identification as **one control**, not as
separate name and phone inputs, reading in three states: nothing chosen, a
customer chosen, or deliberately skipped. It SHALL show the chosen customer's
name and canonical phone, and SHALL offer a single action that clears it back to
nothing chosen.

The control SHALL open a dialog carrying an on-screen numeric keypad built in the
same idiom as tender capture, so a number is entered by thumb without a system
keyboard. The dialog SHALL NOT offer a search button; entry alone SHALL be
sufficient.

The composer SHALL NOT display a separate sentence instructing the biller to add
a customer; the state of the control and the availability of the terminal actions
SHALL carry that.

#### Scenario: The biller opens the control
- **WHEN** the customer control is tapped
- **THEN** a dialog opens with a numeric keypad and an empty number readout

#### Scenario: A chosen customer is cleared
- **WHEN** the biller clears the chosen customer
- **THEN** the control returns to nothing chosen and the terminal actions are unavailable again until a decision is made

#### Scenario: The number is entered without a system keyboard
- **WHEN** the biller enters a number in the dialog
- **THEN** every digit is entered from the on-screen pad, and no device keyboard is required

### Requirement: Skipping customer identification is deliberate and takes one tap

The dialog SHALL offer a skip that records no customer facts at all. The order
SHALL then be identified by its order number, which is what the preparation
pipeline and the shift's bill list display for it.

Skip SHALL be reachable only from inside the dialog, and SHALL NOT appear as a
control on the composer beside the customer row.

Skipping SHALL NOT prompt for a reason, SHALL NOT require an approval, and SHALL
NOT be limited in number.

#### Scenario: A customer gives no number
- **WHEN** the biller skips
- **THEN** the order is accepted carrying no customer name and no phone, no customer record is created, both terminal actions become available, and the preparation card identifies the order by its order number

#### Scenario: An order rung before this change is reopened
- **WHEN** an order carrying a name but no phone is reopened at the counter
- **THEN** the name it was rung under is preserved unchanged, and nothing about it identifies a customer or creates a record

#### Scenario: Skip is not reachable from the composer
- **WHEN** the composer is displayed with a bill in progress
- **THEN** no control on it skips customer identification without opening the dialog first
