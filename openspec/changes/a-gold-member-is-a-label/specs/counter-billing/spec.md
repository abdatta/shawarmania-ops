## MODIFIED Requirements

### Requirement: The customer is identified from one control that opens a keypad

> Extended from `a-customer-is-a-phone-number` (#56), which built this control
> and deliberately left the mark's place on it empty.
>
> **Also corrected here.** The previous text required *"a single action that
> clears it back to nothing chosen"*. That was the ✕ the owner had removed at
> #56's checkpoint on 2026-09-19 — it returned the row to a state the biller then
> had to leave again through the same dialog — and the requirement outlived it. A
> decision is revised by reopening the control and making a different one.

The composer SHALL present customer identification as **one control**, not as
separate name and phone inputs, reading in three states: nothing chosen, a
customer chosen, or deliberately skipped. It SHALL show the chosen customer's
name and canonical phone. It SHALL NOT carry a separate action beside it; tapping
the control SHALL reopen the dialog, and a decision SHALL be revised by making a
different one there.

Where the chosen customer holds a membership, the control SHALL carry the member
mark, and the dialog SHALL carry it on the resolved match and on a partial-number
suggestion before the biller accepts either, so that membership is known while
there is still a choice to make about the order.

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

#### Scenario: A member is resolved in the dialog
- **WHEN** a complete phone matches a customer holding a membership
- **THEN** the match carries the member mark before it is accepted, and shows no date, actor or figure

#### Scenario: A member is suggested from a partial number
- **WHEN** a partial number suggests a customer this outlet has served who holds a membership
- **THEN** the suggestion carries the member mark, and shows no date, actor or figure

#### Scenario: A chosen customer is changed
- **WHEN** the biller taps the chosen customer's control
- **THEN** the dialog reopens, and the choice changes only when a different number is accepted or the biller skips

#### Scenario: The number is entered without a system keyboard
- **WHEN** the biller enters a number in the dialog
- **THEN** every digit is entered from the on-screen pad, and no device keyboard is required

### Requirement: A saved order enters the preparation pipeline

On saving, the surface SHALL put the order directly into the pipeline list at
its newest end, where its complete quantity-and-item lines SHALL be the primary
information, followed by the customer name when one exists and the prominent
total. Where the order was rung for a member, its card SHALL carry the member
mark, read from the order's own snapshot, so preparation can be ordered or
handled differently. Its order number SHALL remain visible as a secondary
reference until payment or cancellation. The surface SHALL NOT add a separate
latest-order card that can represent only one of several rapid orders. The order
number SHALL be visually distinct from a bill number wherever both could be
seen.

#### Scenario: The order is saved

- **WHEN** an order is accepted
- **THEN** its preparation items and total appear immediately at the newest end of the pipeline list, its customer is shown when known, and its order number remains available as a small reference

#### Scenario: A member's order reaches the pipeline

- **WHEN** an order rung for a member appears in the pipeline list
- **THEN** its card carries the member mark, and it carries no membership date, actor or figure

#### Scenario: The order is paid

- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable
