# Delta: profit-estimates

`#51 navigation-groups-and-surface-cull` removes this capability whole, because
the estimate it governed had no live reader once `#13 owner-console-live` was
withdrawn. That removal is correct and stays in the archive. This change re-adds
the capability because a reader now exists — the Ledger's month reading, derived
from recorded rows rather than demonstration data — and because the reopen
trigger stated in `openspec/todos/owner-console-was-withdrawn.md` has fired.

Two differences from the text #51 removes. The requirement is titled for the one
basis that survives, rather than for the two it was written with; and it now
**names the surface** that must state the basis, which the original could not,
having no reader to name.

## ADDED Requirements

### Requirement: Profit is reported on one named basis, and the basis is always stated

Profit SHALL be reported on a **cash basis**: sales for the period less expenses
paid in the period, with the basis named on screen wherever a profit figure
appears, and with the figure presented as a **ceiling** while any contributing
aggregator commission for the period remains undetermined.

The figure SHALL be computed from the promoted expense record and from bills,
sourced aggregator channel days and drawer records. No notebook table SHALL
appear in the chain, and the archived notebook rows SHALL remain unreachable.

**The Ledger's month reading is the surface that carries this figure**, and it
SHALL name the basis there. A profit figure SHALL NOT appear anywhere that does
not name its basis.

**The consumption basis stays withdrawn**, and the reason is recorded rather than
left as an absent option. It exists to count food used instead of food bought,
which requires inventory movements. Inventory is shelved
(`openspec/todos/inventory-is-shelved.md`), so the basis cannot be computed at
all, and a named basis that returns nothing is worse than one basis honestly
offered. It returns with inventory or not at all.

The figure remains a cash-basis **operating** estimate. Capital spending is not
recorded as an expense, so drawer cash spent on equipment is a drawer spend with
its reason and does not enter this figure. The surface SHALL continue to say so.

Where **no** date in the period carries a bill there is no revenue to derive, and
**no profit figure SHALL be offered at all**. A ceiling is a figure that may fall;
this is the absence of a measurement, and the two SHALL NOT be rendered alike.

Where **some** dates in the period carry no bills, a profit figure SHALL be
offered and SHALL be qualified by how many such dates there were. It is
understated by the trade nobody rang up, and a reader SHALL be told so beside the
figure rather than only beside the revenue total.

#### Scenario: The basis is named

- **WHEN** any profit figure is shown
- **THEN** it is labelled as a cash-basis operating estimate

#### Scenario: A month with an undetermined commission

- **WHEN** any day in the period carries an aggregator commission that is not yet determined
- **THEN** the profit figure is presented as a ceiling and the surface says why

#### Scenario: No second basis is offered

- **WHEN** the profit figure is rendered
- **THEN** it offers one basis, and no control implies a consumption basis is available

#### Scenario: Equipment bought from the drawer

- **WHEN** drawer cash pays for equipment and is recorded as a drawer spend
- **THEN** the drawer reconciles and the period's profit figure is unchanged

#### Scenario: A period with no billed date offers no figure

- **WHEN** no date in the period carries a bill
- **THEN** no profit figure is shown, and the reading says there are no recorded
  sales for the period rather than reporting a loss

#### Scenario: A period with some unbilled dates qualifies its figure

- **WHEN** eleven of the period's dates carry no bills
- **THEN** a profit figure is shown and the eleven dates are named against it, not
  against the revenue total alone

### Requirement: Profit arithmetic is integer paise and rejects anything else

Every profit computation SHALL operate on integer paise and SHALL reject a
non-integer input rather than rounding it, in the same way the rest of the
money path does.

#### Scenario: A non-integer amount

- **WHEN** a profit computation receives a non-integer paise amount
- **THEN** it throws rather than producing a figure
