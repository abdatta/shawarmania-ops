## MODIFIED Requirements

### Requirement: An order's label lives only while the order is on the rail

An order SHALL carry an optional `label` of 1 to 24 characters after trimming, set
and changed by the order commands while the order is open. It SHALL NOT be a
customer field and SHALL NOT change the order's customer. The database SHALL clear
the label in the same write that takes the order off the rail — its cancellation,
or the moment it is both paid and prepared, whether by the counter or by the day
change — and SHALL accept no other change to it on a paid or cancelled order. The
label SHALL NOT be copied to a bill, a receipt or any report.

The database SHALL keep a copy of the label, as it stood, in the same write that takes the order off the rail, including a
handover. My shift and Billing History SHALL show that kept label beside its
order or bill. A kept label SHALL NOT be written to a bill, a receipt, an SMS, a
public bill link or an export, and SHALL NOT be used as, or offered as, a
customer's name. A label cleared before labels were kept SHALL NOT be recovered.

#### Scenario: Cleared on finishing

- **WHEN** a labelled order is paid and its last dish is then ticked
- **THEN** in the same write the order's label becomes null

#### Scenario: Kept on finishing

- **WHEN** a labelled order is paid and its last dish is then ticked
- **THEN** the rail no longer shows it, and My shift shows the bill with that label

#### Scenario: Cleared by the day change

- **WHEN** the day change finishes a paid, labelled order nobody ticked
- **THEN** its label becomes null with its preparation, and a copy is kept

#### Scenario: Kept while cooking

- **WHEN** a labelled order is paid upfront and its dishes are not yet ticked
- **THEN** it keeps its label on the counter only

#### Scenario: Never on the receipt

- **WHEN** a kept-label order's bill is sent as a receipt or exported
- **THEN** neither carries the label

#### Scenario: A blank label

- **WHEN** an order command carries a label of only spaces, or of 25 characters
- **THEN** a blank label is stored as none, and an over-long one is refused as malformed

### Requirement: A delivery order is made by the kitchen and never billed

An open order at an outlet offering Delivery MAY
be marked a **delivery order** when it is created or revised. A delivery order
SHALL take the day's next order number and enter the preparation pipeline like
any order. It SHALL carry no service type, table, packaging line, discount or
customer, and the database SHALL refuse a command that gives it any of them. It
SHALL never be paid: the database SHALL refuse payment of a delivery order. While it is open, a revision MAY mark it a delivery order
or an ordinary one.

A delivery order's paise totals exist only because its lines snapshot the
counter's prices. No read SHALL sum, show or export them.

#### Scenario: A delivery order is saved

- **WHEN** a biller at an outlet offering Delivery saves an order marked Delivery
- **THEN** it takes the next order number, appears on the rail and the kitchen board, and no bill exists for it

#### Scenario: A hand-crafted payment

- **WHEN** a request pays an open delivery order
- **THEN** the database refuses it, no bill is created and no bill number is consumed

#### Scenario: A delivery order with a discount

- **WHEN** a create or revise command marks an order Delivery and carries a discount, a customer or a service
- **THEN** the database refuses it as malformed and changes nothing
