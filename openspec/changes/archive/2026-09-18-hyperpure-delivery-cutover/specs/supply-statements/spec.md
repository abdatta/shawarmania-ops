## MODIFIED Requirements

### Requirement: One supplier order becomes one expense, keyed on the order

A supply purchase SHALL enter the ledger as exactly one expense row per supplier
order, identified by the supplier's source system and own order number. For a
supplier account whose order numbers are account-global, including Hyperpure,
that identity SHALL be global across outlets and SHALL NOT include `outlet_id`.

That identity SHALL be the uniqueness key, so re-reading a statement, reading a
later statement that still contains the order, supplying the same statement by
hand, and changing the effective delivery outlet SHALL together produce one row
and never a second. Deduplicating by amount and date SHALL NOT be relied on for
this, because two genuine purchases of similar size on nearby days are ordinary.

An order MAY carry one invoice or several. The expense amount SHALL be the sum of
whatever invoices the order carries, less any credit note against it. A count of
invoices SHALL NOT be assumed.

#### Scenario: The same order arrives three ways

- **WHEN** one order is written by the daily reader, then appears again in a later statement, then is supplied by hand in an uploaded statement
- **THEN** the ledger holds one expense row for it, carrying the latest figures, and no duplicate exists

#### Scenario: A replay crosses a delivery-outlet cutover

- **WHEN** a later statement repeats an order first recorded under the delivery route in force on its invoice date, after a newer route has taken effect
- **THEN** the original order remains one row at its invoice-date outlet and no row is created at the newer outlet

#### Scenario: An order with a single invoice

- **WHEN** an order carries only one invoice rather than a taxable and a non-taxable pair
- **THEN** its expense equals that invoice, and nothing treats the order as half-recorded

#### Scenario: A credit note reduces the purchase

- **WHEN** a credit note is issued against an order
- **THEN** the expense for that order is reduced by it rather than a separate negative row being created

### Requirement: A supply purchase is booked once against one outlet and marked as shared

A supply purchase SHALL be booked once, against the outlet the goods were
delivered to on its invoice date, and SHALL be marked as a shared cost wherever
the outlets served by one supplier account draw on a single inventory.

Where the delivery outlet changes, the system SHALL hold effective-dated routing
and SHALL resolve each order against the route in force on that order's invoice
date. A current provider-app location or one undated current-outlet flag SHALL
NOT rewrite earlier delivery history. A statement spanning a cutover SHALL be
able to book orders on both sides of it in one ingest.

It SHALL NOT be split across outlets by any ratio derived from the supplier's
data, because the only per-outlet signal such data carries is which payout had
capacity to pay, which is a financing fact and not a record of what each kitchen
consumed. The marking exists so the figure can be reallocated later without
reading the supplier again.

#### Scenario: A purchase is not duplicated across outlets

- **WHEN** a purchase's cost is recovered against two outlets' payouts
- **THEN** one expense exists, against the delivery outlet, marked shared, and the second outlet gains no row

#### Scenario: One statement spans a physical-delivery cutover

- **WHEN** a Hyperpure statement contains orders invoiced through 15 September 2026 and orders invoiced from 16 September 2026
- **THEN** the earlier orders are booked once at Kanchrapara, the later orders are booked once at Kalyani, and the supplier app's current location does not alter either result

#### Scenario: A caller cannot route an order by assertion

- **WHEN** a statement payload names an outlet different from the effective route for an order's source and invoice date
- **THEN** the database uses its effective-dated route, verifies that outlet is within the caller's derived authority, and never accepts the asserted outlet as routing authority

