## ADDED Requirements

### Requirement: Items and Sales show counter or delivery orders, never both

While `delivery-orders` is on, Items and Sales SHALL offer a **Counter ·
Delivery** switch, Counter by default and remembered per page on the device.
Counter SHALL read exactly as before. Delivery SHALL count only handed-over
delivery orders, by the order's business date for Day and Week and its
Kolkata order time for Hour. On Items it SHALL show Items sold per dish and
category; on Sales, the Orders measure. Revenue, AOV and Dish revenue SHALL be
unavailable in Delivery and say why. No view SHALL combine counter and
delivery orders. Sales' delivery revenue section, which reads the platforms'
own figures, SHALL be unaffected by the switch.

#### Scenario: Which dishes sell on Zomato

- **WHEN** the owner switches Items to Delivery for the week
- **THEN** each dish shows how many were handed over in delivery orders, and Dish revenue cannot be chosen

#### Scenario: Revenue is untouched

- **WHEN** the owner switches Sales to Delivery and back
- **THEN** the Counter view's Revenue is the same figure as before, counter plus the platforms' delivery money, and Delivery offered only Orders
