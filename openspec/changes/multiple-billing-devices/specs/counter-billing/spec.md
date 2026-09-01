## ADDED Requirements

### Requirement: A shift summary is one tablet's, and outlet history is both

Bills this shift and My shift SHALL show only what this tablet's current shift
produced. Authorised FA and SA outlet history MAY aggregate every tablet at the
outlet, SHALL count each bill exactly once, and SHALL identify the tablet that
took the order and the tablet that took the payment wherever accountability
depends on it.

Neither surface SHALL order accounting history by bill number as a proxy for
time; ordered time, payment time and business date are what say when.

#### Scenario: Two counters work one outlet

- **WHEN** each tablet has taken payments during its own shift
- **THEN** each counter shows its own totals only, while the manager's outlet history reconciles both with no bill counted twice

#### Scenario: A late sync reorders the numbers

- **WHEN** one tablet's earlier sale is numbered after the other tablet's later one because it synced late
- **THEN** the history reads in time order with both times shown, and the numbers are presented as identifiers rather than as sequence

## MODIFIED Requirements

### Requirement: The composer supports immediate payment and saving an order

The billing composer SHALL offer primary Order and secondary Mark Paid once at
least one line exists and either customer name or phone is nonblank. Order SHALL
create a tablet-owned order without assigning a bill number and SHALL clear the
composer only after the adapter accepts it. Mark Paid SHALL open the tender
dialog and create a paid result after exact payment allocation. This
identification requirement SHALL exist only in the UI; the database SHALL keep
both snapshots nullable. V1 SHALL offer no discount control, and both paths SHALL
carry `discount_paise` as zero.

#### Scenario: Customer pays upfront
- **WHEN** an operator opens Mark Paid, allocates the exact total and confirms Mark Paid
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: No discount is offered
- **WHEN** an operator composes, saves, reopens or pays an order
- **THEN** no discount control appears and the accepted command carries a zero discount

#### Scenario: Food has to be made first
- **WHEN** an operator chooses Order
- **THEN** the order appears in Preparing with its order number and no bill number

#### Scenario: Customer identification is missing
- **WHEN** the current bill has items but both customer name and phone are blank
- **THEN** Order and Mark Paid remain disabled with guidance to add either field, while no database constraint is added
