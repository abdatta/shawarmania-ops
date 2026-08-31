## MODIFIED Requirements

### Requirement: Profit is reported on one of two named bases, and the basis is always stated

Profit SHALL be reported on a **cash basis**: sales for the period less expenses
paid in the period, with the basis named on screen wherever a profit figure
appears, and with the figure presented as a **ceiling** while any contributing
aggregator commission for the period remains undetermined.

The figure SHALL be computed from the promoted expense record and from bills,
sourced aggregator channel days and drawer records. No notebook table SHALL
appear in the chain.

**The consumption basis is withdrawn**, and the reason is recorded rather than
left as an absent option. It exists to count food used instead of food bought,
which requires inventory movements. Inventory is shelved
(`openspec/todos/inventory-is-shelved.md`), so the basis cannot be computed at
all, and a named basis that returns nothing is worse than one basis honestly
offered. It returns with inventory or not at all.

The figure remains a cash-basis **operating** estimate. Capital spending is not
recorded as an expense, so drawer cash spent on equipment is a drawer spend with
its reason and does not enter this figure. The surface SHALL continue to say so.

#### Scenario: The basis is named

- **WHEN** any profit figure is shown
- **THEN** it is labelled as a cash-basis operating estimate

#### Scenario: A month with an undetermined commission

- **WHEN** any day in the period carries an aggregator commission that is not yet determined
- **THEN** the profit figure is presented as a ceiling and the surface says why

#### Scenario: No second basis is offered

- **WHEN** the profit surface is rendered
- **THEN** it offers one basis, and no control implies a consumption basis is available

#### Scenario: Equipment bought from the drawer

- **WHEN** drawer cash pays for equipment and is recorded as a drawer spend
- **THEN** the drawer reconciles and the period's profit figure is unchanged

## REMOVED Requirements

### Requirement: Raw materials are counted once, never twice

**Reason**: the double-counting it prevents is only possible when both a
raw-material expense and inventory consumption exist for one period. Inventory
is shelved, so there is no consumption to count and no second subtraction to
avoid. The requirement returns with inventory, together with the consumption
basis it exists to protect.

Note that this also settles the standing defect recorded in
`openspec/todos/raw-materials-is-identified-by-a-word-nobody-types.md`: the
matcher looked for a value of a closed category list that free-text categories
replaced, so it had been matching nothing since
`expense-categories-grow-from-use`. That todo closes here as dissolved rather
than fixed.
