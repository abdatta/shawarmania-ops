## MODIFIED Requirements

<!-- Rebased on revenue-reads-the-same-everywhere (#76), which modifies this
requirement first and archives first. -->

### Requirement: Profit is reported on one named basis, and the basis is always stated

Profit SHALL be reported as **P&L**: revenue for the period less expenses for
the period, where expenses are every recorded expense, fixed-cost payments
included on the date each counts in, plus delivery commission, as defined by
`business-figures`, with the basis named on screen wherever a profit figure
appears.

**The current month SHALL also offer P&L (Pro-rata), and no other period SHALL.**
Where the outlet has at least one fixed cost active in the current month,
Overview and the Ledger's current month SHALL show, beside P&L, **P&L (Pro-rata)**:
P&L less, for each fixed cost, the part of this month's cost owed up to today
and not yet covered by a payment. A balance owed from an earlier month SHALL NOT enter it. A past
day or month SHALL offer P&L alone, from recorded expenses, and no P&L (Pro-rata)
SHALL be offered or stored for it. A current month with no active fixed cost SHALL
offer P&L alone.

The figure SHALL be computed from the promoted expense record and from bills and
sourced aggregator channel days, and P&L (Pro-rata) additionally from the outlet's
fixed costs. No notebook table SHALL appear in the chain, and the archived
notebook rows SHALL remain unreachable.

**The Ledger's month reading is the surface that carries these figures in
full**, and it SHALL name each basis there. Overview's P&L SHALL be the same
figures. A profit figure SHALL NOT appear anywhere that does not name its basis.

**An unstated commission is named, not presented as a ceiling.** While any
channel-day in the period is waiting for its commission, the Ledger's month
reading SHALL say how many days are waiting and that profit falls by their
commission once it is stated. Overview SHALL NOT qualify its figure for it.

**The consumption basis stays withdrawn**, and the reason is recorded rather than
left as an absent option. It exists to count food used instead of food bought,
which requires inventory movements. Inventory is shelved
(`openspec/todos/inventory-is-shelved.md`), so the basis cannot be computed at
all, and a named basis that returns nothing is worse than a basis honestly
offered. It returns with inventory or not at all.

The figures remain **operating** estimates. Capital spending is not recorded as
an expense, so drawer cash spent on equipment is a drawer spend with its reason
and does not enter either figure. The surface SHALL continue to say so.

Where **no** date in the period records a sale there is no revenue to derive, and
**no profit figure SHALL be offered at all**.

Where **some** dates in the period record no sales, a profit figure SHALL be
offered and SHALL be qualified on the Ledger by how many such dates there were.
It is understated by the trade nobody rang up, and a reader SHALL be told so
beside the figure rather than only beside the revenue total.

#### Scenario: The basis is named

- **WHEN** any profit figure is shown
- **THEN** it is labelled P&L or P&L (Pro-rata), with its basis in words beside it

#### Scenario: P&L (Pro-rata) on the 18th

- **WHEN** it is 18 October, P&L is ₹1,89,368, and one fixed cost of ₹3,22,700 for
  this month is entirely unpaid
- **THEN** P&L (Pro-rata) reads ₹1,993.81

#### Scenario: A salary paid in full mid-month

- **WHEN** a ₹10,000 salary is paid in full on the 20th of a 30-day month
- **THEN** P&L carries ₹10,000 for it from that moment and P&L (Pro-rata) charges
  nothing more for it this month

#### Scenario: Last month's balance stays out of this month

- **WHEN** it is 1 November and a salary's October is unpaid
- **THEN** November's P&L (Pro-rata) does not include October's balance, and Needs
  attention names it

#### Scenario: A past month reads P&L only

- **WHEN** the Ledger shows September, which had fixed costs
- **THEN** it shows P&L from September's recorded expenses and no P&L (Pro-rata)

#### Scenario: A month with an unstated commission

- **WHEN** three days in the period carry a commission not yet stated
- **THEN** the Ledger's profit reads as an estimate, says three days' delivery
  commission is not stated yet, and Overview's P&L shows the same figure without
  a qualifier

#### Scenario: No consumption basis is offered

- **WHEN** a profit figure is rendered
- **THEN** no control implies a consumption basis is available

#### Scenario: Equipment bought from the drawer

- **WHEN** drawer cash pays for equipment and is recorded as a drawer spend
- **THEN** the drawer reconciles and the period's profit figures are unchanged

#### Scenario: A period with no sale on any date offers no figure

- **WHEN** no date in the period records a sale
- **THEN** no profit figure is shown, and the reading says there are no recorded
  sales for the period rather than reporting a loss

#### Scenario: A period with some unbilled dates qualifies its figure

- **WHEN** eleven of the period's dates record no sales
- **THEN** a profit figure is shown and the eleven dates are named against it on
  the Ledger, not against the revenue total alone
