## MODIFIED Requirements

### Requirement: Pipeline orders remain editable until they are paid

The pipeline SHALL list this outlet's unpaid orders, each with its reference,
complete quantity-and-item lines and total. A card SHALL NOT print the
customer's name or the order's age: the list is ordered newest first, and the
customer is one control away (see *A pipeline card states both of its answers in
two fixed controls*). Items SHALL
NOT be truncated or collapsed because these lists are preparation work. Any
operator holding the owning tablet's live shift SHALL reopen and change lines,
quantities and customer form values until payment or cancellation. No discount
control SHALL appear. The original order time and business date SHALL remain
unchanged, and visible on the order while it is edited. On the combined tablet workspace, edit SHALL use the
same menu and composer used for a new order, overlaying the bills column. Any
in-progress new-order draft SHALL be restored exactly after the edit is saved
or cancelled. Once an order is paid, revision SHALL close for it everywhere.

#### Scenario: Staff scans work to prepare

- **WHEN** a pipeline order contains several different items and has a customer name
- **THEN** every item and quantity is readable without expansion, the total is prominent, the card labels its reference as Order # followed by the number, and the customer's name is not printed on the card but opens from its customer control

#### Scenario: Current operator created the order today
- **WHEN** the order was created today by the person holding the current billing shift
- **THEN** the card shows no age and does not repeat that person's name

#### Scenario: Another operator created the order
- **WHEN** the order creator differs from the person holding the current billing shift
- **THEN** the creator's name remains visible on the card's meta line

#### Scenario: Incoming operator edits an order
- **WHEN** a different operator's shift begins on the same tablet and they edit its open order
- **THEN** the order keeps its creator and original date while recording the new acting operator

#### Scenario: Operator changes the whole order
- **WHEN** the operator edits an open order
- **THEN** they can add any available menu item, change or remove existing quantities, and edit customer name or phone from the familiar composer

#### Scenario: A new-order draft already exists
- **WHEN** the operator starts editing an open order while another bill is being composed
- **THEN** the new-order lines, customer fields and payment preset are suspended and restored exactly after Save changes or Cancel edit

#### Scenario: A manager cancelled it first
- **WHEN** an operator tries to pay an order that the outlet's manager cancelled moments earlier
- **THEN** the attempt stops, states that the order was cancelled and by whom, and creates no bill

#### Scenario: Paid closes revision
- **WHEN** an order has been paid and someone attempts to revise it
- **THEN** the attempt is refused and the interface offers no editable copy of it

### Requirement: Live open-order actions stay on the tablet that took the order

Ordinary edit, payment, cancellation and preparation of an order SHALL be
available only on the tablet that owns it, to any operator holding its live
shift. Clearing an order stranded on an unavailable tablet SHALL be an ordinary
reasoned cancellation by that outlet's manager, and no transfer or recovery
path SHALL exist. Cards across the pipeline SHALL label secondary numbers as
Order #, show complete item lines, and omit the creator when the current shift
holder took the order. The payment action
SHALL read Paid and the preparation action Prepared.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may prepare, edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

#### Scenario: Another tablet of the outlet sees but cannot act
- **WHEN** a second billing device at the outlet displays the pipeline and its operator attempts to act on the first tablet's order
- **THEN** the database refuses the command under the owning-tablet rule while the order remains visible with its creator named

### Requirement: A pipeline card states both of its answers in two fixed controls

A pipeline card SHALL show its reference with the number part in the brand's
bright primary colour, followed by one place tag — its table, or its order type
when it has no table — drawn in a single style for both, with an icon and small
capitals that do not read as an item line; one meta line — creator when another
operator took the order, till when another till did — the total prominent at
the right, and complete untruncated item lines with
bold quantity prefixes. The card SHALL NOT print the customer's name or the
order's age.

Beside the total, a card SHALL carry one customer control whenever the order has
a customer or one can be set from this tablet. With a customer, it SHALL open
what the order recorded — name, phone and membership — and, while the order can
be edited here, offer to change it. A gold member's star SHALL sit on that
control rather than beside the reference, because it describes the customer. Without one, or when the biller changes it, it SHALL open the order in the
composer with the customer dialog already open: the ordinary edit and its
ordinary revision, with no new write. Because the customer is the whole of that
edit, choosing in the dialog SHALL save it at once — Use attaches the customer,
Skip saves the order with no customer, as Skip means everywhere else — and
closing the dialog without choosing SHALL abandon the edit and leave the order
unchanged [owner, 2026-10-05]. Per-line prices SHALL NOT appear on a pipeline card. A
one-item card SHALL stand no taller than about 120px so at least six fit the rail
at landscape tablet height without scrolling. Item names SHALL never truncate.

Beneath that, every card SHALL carry exactly two state controls, **Prepared**
then **Paid**, in that order and at equal width, on every card in every state.
Neither control SHALL be reordered, resized, renamed or withheld because of the
order's state: the words **Prepared** and **Paid** SHALL be the only words those
controls ever read, and the interface SHALL contain no Reprepare and no Un-pay.

Each control SHALL draw a checkbox stating whether that fact is recorded. An
unrecorded fact SHALL draw an unchecked box in its own colour on an otherwise
ordinary secondary control — preparation in the brand primary, payment in the
success colour. A recorded fact SHALL fill its control with that colour and draw
the checked box and its mark in that control's own foreground token, so the mark
stays legible on the fill in both themes. Recorded and unrecorded SHALL differ in
**shape** as well as colour. No separate paid badge SHALL be drawn, because the
checked payment control already says it.

Activating an unchecked payment control SHALL open the tender dialog, and the
control SHALL become checked only once payment is recorded. Activating a checked
payment control SHALL open the reasoned take-back confirmation. Activating either
preparation state SHALL record it directly.

Where a fact cannot be changed from this tablet — which in the pipeline means
another till's order, since a payment on a card still in the list is always
reversible — its control SHALL be drawn **without control chrome**, as a
statement of what is true, and SHALL NOT be drawn as a dimmed or disabled
control.

All uncommon actions SHALL sit behind one overflow control presenting touch-safe
labelled rows: Edit and Cancel on an unpaid card, and Cancel after paid on a paid
card. Edit SHALL be unavailable once an order is paid.

#### Scenario: Two cards in different states read the same way

- **WHEN** a biller reads an unprepared card and a prepared card side by side
- **THEN** both carry Prepared then Paid in the same places with the same words, and only the boxes and the fills differ

#### Scenario: Recording preparation changes only the card's appearance

- **WHEN** the operator checks Prepared
- **THEN** that control fills with the preparation colour and shows a checked box, the payment control is untouched in place and wording, and no badge appears

#### Scenario: Payment is recorded through the tender dialog

- **WHEN** the operator activates an unchecked Paid control
- **THEN** the tender dialog opens and the control becomes checked only after an exact allocation is recorded

#### Scenario: A recorded payment is taken back from its own control

- **WHEN** the operator activates a checked Paid control on a card in the list
- **THEN** the reasoned take-back confirmation opens, naming the amount and tender, and no control has renamed itself to offer it

#### Scenario: Every ticked payment in the list can be unticked

- **WHEN** any card in the pipeline list shows a checked Paid control on this till's order
- **THEN** activating it opens the take-back rather than refusing, because a card leaves the list as soon as its ticket is finished

#### Scenario: What cannot be changed is not drawn as a broken control

- **WHEN** a card belongs to another till
- **THEN** both controls are drawn as statements without control chrome rather than as dimmed controls, and the card names the till

#### Scenario: State survives without colour

- **WHEN** the two controls are compared without relying on hue
- **THEN** checked and unchecked differ by the shape inside the box

#### Scenario: Rare actions keep their safety

- **WHEN** the operator opens a card's overflow menu
- **THEN** each action is a labelled row at least 40px tall, and cancellation still requires its reasoned confirmation

#### Scenario: A paid order cannot be edited

- **WHEN** the operator opens the overflow of a paid card
- **THEN** Edit is absent or refused with guidance to take the payment back first, and the composer cannot load a paid order's lines for revision

#### Scenario: The customer is one tap away

- **WHEN** a biller taps the customer control on a card whose order has a customer
- **THEN** the order's customer name, phone and membership open over the counter, and nothing about the order changes

#### Scenario: A customer is added from the card

- **WHEN** a biller taps the customer control on this tablet's open order that has no customer
- **THEN** the order opens in the composer with the customer dialog open, and choosing Use saves the order with that customer at once, with no Save changes

#### Scenario: Skip from the card removes the customer

- **WHEN** a biller changes an order's customer from its card and chooses Skip
- **THEN** the order is saved at once with no customer's number, and leaves edit mode

#### Scenario: Closing the dialog from the card changes nothing

- **WHEN** a biller opens the customer dialog from a card and closes it without choosing
- **THEN** the edit is abandoned, the order is unchanged, and nothing is written
