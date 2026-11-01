## ADDED Requirements

### Requirement: A delivery order is made by the kitchen and never billed

While `delivery-orders` is on, an open order at an outlet offering Delivery MAY
be marked a **delivery order** when it is created or revised. A delivery order
SHALL take the day's next order number and enter the preparation pipeline like
any order. It SHALL carry no service type, table, packaging line, discount or
customer, and the database SHALL refuse a command that gives it any of them. It
SHALL never be paid: the database SHALL refuse payment of a delivery order
while the gate is on. While it is open, a revision MAY mark it a delivery order
or an ordinary one.

A delivery order's paise totals exist only because its lines snapshot the
counter's prices. No read SHALL sum, show or export them.

#### Scenario: A delivery order is saved

- **WHEN** a biller at an outlet offering Delivery saves an order marked Delivery
- **THEN** it takes the next order number, appears on the rail and the kitchen board, and no bill exists for it

#### Scenario: A hand-crafted payment

- **WHEN** a request pays an open delivery order while the gate is on
- **THEN** the database refuses it, no bill is created and no bill number is consumed

#### Scenario: A delivery order with a discount

- **WHEN** a create or revise command marks an order Delivery and carries a discount, a customer or a service
- **THEN** the database refuses it as malformed and changes nothing

### Requirement: A delivery order is handed over, and a handover can be taken back

Handing over a delivery order SHALL, in one command on the owning tablet's live
shift, tick every line with food still owed, record who handed it over, when,
on which shift and device, and set the order's status to `handed_over`. A
handed-over order SHALL leave the rail and the kitchen board, SHALL NOT block
the business day's sign-off, and SHALL refuse every order command except a
take-back, with the not-open category.

The owning tablet SHALL be able to take a handover back, with a non-blank
reason, until five minutes after its stored `handed_over_at`. Taking it back
SHALL record the handover and the take-back with their actors, times and
reason; remove the ticks the handover wrote and no others; and return the
order to `open`, on the rail as it was before the handover. A take-back
arriving after the window SHALL be refused as late.

Every handover and take-back SHALL carry a client UUID and be idempotent, and
the server SHALL accept them whatever the gate says.

#### Scenario: Handed to a rider

- **WHEN** a biller hands over a delivery order with one dish still owed
- **THEN** that dish is ticked, the order is handed over and off the rail, and the day's readiness does not list it

#### Scenario: A mistaken handover

- **WHEN** the biller takes the handover back two minutes later, giving a reason
- **THEN** the order is open on the rail again with that dish unticked, as it was before, and the handover and take-back are both recorded

#### Scenario: Too late

- **WHEN** a take-back reaches the server six minutes after the handover
- **THEN** it is refused as late and the order stays handed over

#### Scenario: Another tablet

- **WHEN** a second counter at the outlet sends a handover or take-back for an order the first tablet owns
- **THEN** the database refuses it

### Requirement: Delivery records are outlet records no other outlet can read

`delivery_orders`, `delivery_handover_takebacks` and `kept_order_labels` SHALL
be readable only by a live counter shift at their outlet, that outlet's
Franchise Admins and the owner. A kitchen SHALL NOT read them directly. No
role SHALL write them except through the order commands and their triggers.

#### Scenario: A manager crafts a foreign-outlet read

- **WHEN** a Franchise Admin of one outlet selects another outlet's delivery orders or kept labels
- **THEN** no rows are returned

## MODIFIED Requirements

### Requirement: An order's label lives only while the order is on the rail

An order SHALL carry an optional `label` of 1 to 24 characters after trimming, set
and changed by the order commands while the order is open. It SHALL NOT be a
customer field and SHALL NOT change the order's customer. The database SHALL clear
the label in the same write that takes the order off the rail — its cancellation,
or the moment it is both paid and prepared, whether by the counter or by the day
change — and SHALL accept no other change to it on a paid or cancelled order. The
label SHALL NOT be copied to a bill, a receipt or any report.

While `delivery-orders` is on, the database SHALL keep a copy of the label, as
it stood, in the same write that takes the order off the rail, including a
handover. My shift and Billing History SHALL show that kept label beside its
order or bill. A kept label SHALL NOT be written to a bill, a receipt, an SMS, a
public bill link or an export, and SHALL NOT be used as, or offered as, a
customer's name. A label cleared before the gate was on SHALL NOT be recovered.

#### Scenario: Cleared on finishing

- **WHEN** a labelled order is paid and its last dish is then ticked
- **THEN** in the same write the order's label becomes null

#### Scenario: Kept on finishing

- **WHEN** `delivery-orders` is on and a labelled order is paid and its last dish is then ticked
- **THEN** the rail no longer shows it, and My shift shows the bill with that label

#### Scenario: Cleared by the day change

- **WHEN** the day change finishes a paid, labelled order nobody ticked
- **THEN** its label becomes null with its preparation, and while `delivery-orders` is on a copy is kept

#### Scenario: Kept while cooking

- **WHEN** a labelled order is paid upfront and its dishes are not yet ticked
- **THEN** it keeps its label on the counter only

#### Scenario: Never on the receipt

- **WHEN** a kept-label order's bill is sent as a receipt or exported
- **THEN** neither carries the label

#### Scenario: A blank label

- **WHEN** an order command carries a label of only spaces, or of 25 characters
- **THEN** a blank label is stored as none, and an over-long one is refused as malformed
