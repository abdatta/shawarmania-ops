## MODIFIED Requirements

### Requirement: The composer offers Delivery and shows it no money

At an outlet offering Delivery, the composer's
service row SHALL offer **Delivery** beside the outlet's other service choices,
or alone when it offers none. Choosing Delivery SHALL clear any table and
packaging. With Delivery chosen the composer SHALL show no total, no customer
control and no discount control, and its only action SHALL be **Order**.
Delivery SHALL be changeable while the order is open.

#### Scenario: A delivery order is composed

- **WHEN** a biller picks Delivery, adds two dishes and a label, and taps Order
- **THEN** the order is saved with its number and label, no amount is shown anywhere, and Mark Paid is not offered

### Requirement: Stats and Billing History show counter or delivery, never both

Billing's Stats and Billing History SHALL offer a
**Counter · Delivery** switch, Counter by default, remembered per page on the
device. Counter SHALL read as before, except that Stats leaves delivery orders
out of every order count and time. Delivery SHALL show, for the chosen outlet
and day, Stats' delivery orders placed, updated, cancelled, handed over, seen
and Ready, with the two average times; and Billing History's handed-over and
cancelled delivery orders, with dishes, label, who rang each, who handed it
over or cancelled it, and any take-back. Neither view SHALL show a money
figure for a delivery order, and no view SHALL combine the two.

#### Scenario: A peek at delivery

- **WHEN** a manager switches Stats to Delivery for a day with five delivery orders, one taken back and handed over again
- **THEN** Stats shows five placed and five handed over, and switching back to Counter shows the day's counter figures exactly as without those five

#### Scenario: A foreign outlet

- **WHEN** a manager crafts a Delivery Stats or history read for another outlet
- **THEN** the database refuses it
