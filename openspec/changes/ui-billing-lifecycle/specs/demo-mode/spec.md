## ADDED Requirements

### Requirement: Demo data walks the complete order-to-payment lifecycle

The coherent demo store SHALL include direct payment, an editable unpaid order,
payment after cutoff, cancellation, a late synchronization, a quarantined
attempt, and audited stranded-device recovery. All customer, bill, revenue, and
drawer figures SHALL remain internally consistent across role surfaces.

#### Scenario: Deferred cash payment crosses cutoff
- **WHEN** the demo order is created on one business date and paid cash after its cutoff
- **THEN** revenue appears on the order date, cash appears on the payment date, and every summary agrees

#### Scenario: Demo reset
- **WHEN** the lifecycle is changed during a walkthrough and demo reset is used
- **THEN** every open order, bill, customer, exception, and aggregate returns to the canonical scenario

### Requirement: Demo customer identity is global without exposing outlet history

The synthetic scenario SHALL include one invented phone identity used at both
outlets. Exact lookup SHALL recognize it, while an outlet-scoped history adapter
SHALL return only that outlet's bills.

#### Scenario: Same demo customer visits both outlets
- **WHEN** each outlet enters the complete synthetic phone
- **THEN** both receive the same saved profile and neither receives the other outlet's bills
