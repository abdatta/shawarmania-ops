# Profit Estimates

## Purpose

Guarantees that estimated profit is reported as a named cash-basis operating estimate, presented as a ceiling while aggregator commission remains undetermined, with integer paise throughout. The consumption basis stays absent until inventory movements make it computable.

## Requirements

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

### Requirement: Profit arithmetic is integer paise and rejects anything else

Every profit computation SHALL operate on integer paise and SHALL reject a
non-integer input rather than rounding it, in the same way the rest of the
money path does.

#### Scenario: A non-integer amount

- **WHEN** a profit computation receives a non-integer paise amount
- **THEN** it throws rather than producing a figure
