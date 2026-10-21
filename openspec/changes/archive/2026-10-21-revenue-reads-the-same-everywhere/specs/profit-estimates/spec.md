## MODIFIED Requirements

### Requirement: Profit is reported on one named basis, and the basis is always stated

Profit SHALL be reported on a **cash basis**: revenue for the period less
expenses for the period, where expenses include delivery commission, as defined
by `business-figures`, with the basis named on screen wherever a profit figure
appears.

The figure SHALL be computed from the promoted expense record and from bills and
sourced aggregator channel days. No notebook table SHALL appear in the chain, and
the archived notebook rows SHALL remain unreachable.

**The Ledger's month reading is the surface that carries this figure in full**,
and it SHALL name the basis there. Overview's P&L SHALL be the same figure,
labelled as an estimate. A profit figure SHALL NOT appear anywhere that does not
name its basis.

**An unstated commission is named, not presented as a ceiling.** While any
channel-day in the period is waiting for its commission, the Ledger's month
reading SHALL say how many days are waiting and that profit falls by their
commission once it is stated. Overview SHALL NOT qualify its figure for it.

**The consumption basis stays withdrawn**, and the reason is recorded rather than
left as an absent option. It exists to count food used instead of food bought,
which requires inventory movements. Inventory is shelved
(`openspec/todos/inventory-is-shelved.md`), so the basis cannot be computed at
all, and a named basis that returns nothing is worse than one basis honestly
offered. It returns with inventory or not at all.

The figure remains a cash-basis **operating** estimate. Capital spending is not
recorded as an expense, so drawer cash spent on equipment is a drawer spend with
its reason and does not enter this figure. The surface SHALL continue to say so.

Where **no** date in the period records a sale there is no revenue to derive, and
**no profit figure SHALL be offered at all**.

Where **some** dates in the period record no sales, a profit figure SHALL be
offered and SHALL be qualified on the Ledger by how many such dates there were.
It is understated by the trade nobody rang up, and a reader SHALL be told so
beside the figure rather than only beside the revenue total.

#### Scenario: The basis is named

- **WHEN** any profit figure is shown
- **THEN** it is labelled as a cash-basis operating estimate

#### Scenario: A month with an unstated commission

- **WHEN** three days in the period carry a commission not yet stated
- **THEN** the Ledger's profit reads as an estimate, says three days' delivery
  commission is not stated yet, and Overview's P&L shows the same figure without
  a qualifier

#### Scenario: No second basis is offered

- **WHEN** the profit figure is rendered
- **THEN** it offers one basis, and no control implies a consumption basis is available

#### Scenario: Equipment bought from the drawer

- **WHEN** drawer cash pays for equipment and is recorded as a drawer spend
- **THEN** the drawer reconciles and the period's profit figure is unchanged

#### Scenario: A period with no sale on any date offers no figure

- **WHEN** no date in the period records a sale
- **THEN** no profit figure is shown, and the reading says there are no recorded
  sales for the period rather than reporting a loss

#### Scenario: A period with some unbilled dates qualifies its figure

- **WHEN** eleven of the period's dates record no sales
- **THEN** a profit figure is shown and the eleven dates are named against it on
  the Ledger, not against the revenue total alone
