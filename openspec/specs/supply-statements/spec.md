# Supply Statements

## Purpose

How a supplier's own statement becomes ledger expenses: one supplier order becomes
one expense keyed on the order number, dated by the day the goods arrived, booked
once against the delivery outlet and marked shared. Collecting a purchase from a
payout is not making one, and a delivered order the statement omits is reported
rather than assumed absent.

## Requirements

### Requirement: One supplier order becomes one expense, keyed on the order

A supply purchase SHALL enter the ledger as exactly one expense row per supplier
order, identified by the supplier's own order number.

That identity SHALL be the uniqueness key, so re-reading a statement, reading a
later statement that still contains the order, and a person supplying the same
statement by hand SHALL together produce one row and never a second. Deduplicating
by amount and date SHALL NOT be relied on for this, because two genuine purchases
of similar size on nearby days are ordinary.

An order MAY carry one invoice or several. The expense amount SHALL be the sum of
whatever invoices the order carries, less any credit note against it. A count of
invoices SHALL NOT be assumed.

#### Scenario: The same order arrives three ways

- **WHEN** one order is written by the daily reader, then appears again in a later statement, then is supplied by hand in an uploaded statement
- **THEN** the ledger holds one expense row for it, carrying the latest figures, and no duplicate exists

#### Scenario: An order with a single invoice

- **WHEN** an order carries only one invoice rather than a taxable and a non-taxable pair
- **THEN** its expense equals that invoice, and nothing treats the order as half-recorded

#### Scenario: A credit note reduces the purchase

- **WHEN** a credit note is issued against an order
- **THEN** the expense for that order is reduced by it rather than a separate negative row being created

### Requirement: A supply purchase is dated by the day the goods arrived

A supply purchase SHALL be dated by its invoice date, which is the day the goods
were delivered and the day the supplier's own statement filters on. It SHALL NOT
be dated by the order date, which precedes delivery by one or two days
inconsistently, nor by the day it was paid.

Where an order's invoice date precedes the first business date the ledger holds,
the purchase SHALL be dated to that first date, so a cost settled from an
in-period payout is recorded rather than lost to a period the books do not cover.

#### Scenario: An order placed at night is dated to the morning it arrived

- **WHEN** an order is placed late on one date and invoiced on delivery the next morning
- **THEN** the expense is dated to the invoice date, not the order date

#### Scenario: A purchase older than the books enters on the opening date

- **WHEN** an order's invoice date precedes the earliest business date the ledger holds, and its payment was collected within a period the ledger does cover
- **THEN** the expense is dated to that earliest business date rather than discarded

### Requirement: Collecting a purchase is not making one

A recovery of a supply purchase from a payout an aggregator owes SHALL reconcile
that payout cycle and SHALL create no expense row, because the supplier's own
statement already recorded the purchase.

The reconciliation sum for a cycle SHALL nevertheless count every recovery in
that cycle, including recoveries of purchases dated before the ledger's opening
date, because the money genuinely left that payout. **The origin governs what is
written; the cycle governs what the payout is measured against.**

A deduction that is not a supply recovery, such as advertising, SHALL still create
an expense, because no other origin sees it.

#### Scenario: A recovery reconciles and writes nothing

- **WHEN** a payout cycle carries a recovery of a supply purchase
- **THEN** the cycle's computed payout accounts for it, and no expense row is created for it

#### Scenario: A purchase recovered in slices is still one expense

- **WHEN** one order's cost is recovered across two payout cycles, partly against one outlet and partly against another
- **THEN** the ledger still holds exactly one expense for that order, and neither outlet gains a second

#### Scenario: An advertising deduction still becomes an expense

- **WHEN** a payout cycle carries a deduction that is not a supply recovery
- **THEN** an expense is created for it, dated to when it was incurred

### Requirement: A supply purchase is booked once against one outlet and marked as shared

A supply purchase SHALL be booked once, against the outlet the goods were
delivered to, and SHALL be marked as a shared cost, wherever the outlets served
by one supplier account draw on a single inventory.

It SHALL NOT be split across outlets by any ratio derived from the supplier's
data, because the only per-outlet signal such data carries is which payout had
capacity to pay, which is a financing fact and not a record of what each kitchen
consumed. The marking exists so the figure can be reallocated later without
reading the supplier again.

#### Scenario: A purchase is not duplicated across outlets

- **WHEN** a purchase's cost is recovered against two outlets' payouts
- **THEN** one expense exists, against the delivery outlet, marked shared, and the second outlet gains no row

### Requirement: A delivered order the statement omits is reported, not assumed absent

The reader SHALL reconcile the supplier's statement against the supplier's own
list of delivered orders for the same period, and SHALL report any delivered
order the statement does not contain.

It SHALL NOT treat the statement's silence as evidence that no purchase happened,
because a statement that lists only settled purchases would under-report every
purchase awaiting collection, and under-reporting a cost overstates profit.

#### Scenario: A delivered order missing from the statement is surfaced

- **WHEN** the supplier's order list contains a delivered order for the period and the statement does not
- **THEN** the run reports it as a discrepancy naming the order, and does not record the period as fully read
