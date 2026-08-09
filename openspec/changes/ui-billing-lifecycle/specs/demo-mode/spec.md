## ADDED Requirements

### Requirement: Demo data walks the complete order-to-payment lifecycle

The coherent demo store SHALL include a direct payment, an editable open order
paid on handover, an aggregator order collected by a rider, a cancellation with
its reason, a bill that is not sent yet, and one command needing attention. Every
customer, bill, revenue and drawer figure SHALL stay internally consistent across
role surfaces.

#### Scenario: An order taken before cutover is paid after it
- **WHEN** the demo order is created on one business date and paid in cash after that date's cutover
- **THEN** revenue appears on the order date, cash appears on the payment date, and every summary agrees

#### Scenario: An aggregator order is collected
- **WHEN** the demo aggregator order is paid by that aggregator's method
- **THEN** it leaves Open orders as a paid bill and the outlet's method totals agree

#### Scenario: Demo reset
- **WHEN** the lifecycle is changed during a walkthrough and demo reset is used
- **THEN** every open order, bill, customer, exception and aggregate returns to the canonical scenario

### Requirement: Demo customer identity is global without exposing outlet history

The synthetic scenario SHALL include one invented phone identity used at both
outlets. Exact lookup SHALL recognise it, while an outlet-scoped history adapter
SHALL return only that outlet's bills.

#### Scenario: The same demo customer visits both outlets
- **WHEN** each outlet enters the complete synthetic phone
- **THEN** both receive the same saved profile and neither receives the other outlet's bills
