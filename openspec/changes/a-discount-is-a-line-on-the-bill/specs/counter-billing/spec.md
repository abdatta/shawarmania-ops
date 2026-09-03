## MODIFIED Requirements

### Requirement: The composer supports immediate payment and saving an order

> Reversing the discount clause **#35 restated on 2026-09-02**. That change must
> archive before this delta applies, or the two edit one paragraph in opposite
> directions.

The billing composer SHALL offer primary Order and secondary Mark Paid once at
least one line exists and either customer name or phone is nonblank. Order SHALL
create a tablet-owned order without assigning a bill number and SHALL clear the
composer only after the adapter accepts it. Mark Paid SHALL open the tender dialog
and create a paid result after exact payment allocation. This identification
requirement SHALL exist only in the UI; the database SHALL keep both snapshots
nullable.

The composer SHALL offer an **Add discount** control, positioned below the lines
in the bill column, and both paths SHALL carry whatever discount results.

#### Scenario: Customer pays upfront
- **WHEN** an operator opens Mark Paid, allocates the exact total and confirms Mark Paid
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: A discount is applied before the order leaves
- **WHEN** an operator adds a discount and then chooses Order or Mark Paid
- **THEN** the accepted command carries that discount, its basis, and the bill's
  rounding

#### Scenario: Food has to be made first
- **WHEN** an operator chooses Order
- **THEN** the order appears in Preparing with its order number and no bill number

#### Scenario: Customer identification is missing
- **WHEN** the current bill has items but both customer name and phone are blank
- **THEN** Order and Mark Paid remain disabled with guidance to add either field, while no database constraint is added

## ADDED Requirements

### Requirement: Adding a discount is a keypad panel built like tender capture

The Add discount control SHALL open a panel assembled from the same parts as the
tender dialog, so that the counter learns one interaction rather than two.

The panel SHALL show a single readout beginning at nought and displaying the
entered value with its unit. It SHALL offer a percentage unit and a rupee unit,
and switching between them SHALL NOT require the entry to be cleared. Its keypad
SHALL carry the digits one to nine, a decimal point, nought positioned centrally,
and a backspace, and SHALL NOT carry a double-nought key.

The panel SHALL NOT display a resulting total, because a discount is not set by
aiming at a final amount.

The panel SHALL offer the outlet's configured percentage presets, between none and
four of them, on a single row that never wraps.

#### Scenario: The unit is decided after the number

- **WHEN** an operator enters a value and then taps the other unit
- **THEN** the unit changes, the entered value is preserved, and no clearing step
  is required

#### Scenario: A fractional percentage

- **WHEN** an operator enters a percentage carrying a decimal
- **THEN** it is accepted and the resulting discount is exact integer paise

#### Scenario: No presets are configured

- **WHEN** the outlet has no percentage presets configured
- **THEN** the panel shows none, and the keypad and units are unaffected

### Requirement: Discounts read as rows in the bill column, saying what they were

Each discount SHALL appear in the bill column alongside the items, as a row
carrying its reduction and a subtext naming what it applied to.

A menu discount row SHALL name its basis and value, and its subtext SHALL name the
categories it covered. Where one value covers several categories they SHALL be
combined into one row listing them. Where it covers every category in the outlet's
menu the subtext SHALL say so as a single phrase rather than listing them. Where
different values apply, each SHALL have its own row.

A discount applied to the bill SHALL say so in its subtext.

A menu discount row SHALL carry no control to change or remove it. A bill discount
row SHALL carry an edit control, which reopens the panel on that discount, and a
delete control.

The rounding SHALL appear as its own row, below the discounts and above the total.

#### Scenario: One value over two categories

- **WHEN** one menu discount covers two categories and lines from both are on the
  bill
- **THEN** one row appears, and its subtext names both categories

#### Scenario: Two values over different categories

- **WHEN** two menu discounts at different values each reach lines on the bill
- **THEN** two rows appear, each naming its own value and its own categories

#### Scenario: The whole menu is discounted

- **WHEN** a menu discount covers every category in the outlet's menu
- **THEN** its row's subtext says so as one phrase rather than listing every
  category

#### Scenario: A biller reconsiders their own discount

- **WHEN** a biller taps edit on a discount they applied to the bill
- **THEN** the panel reopens carrying that discount's value and unit, and
  confirming replaces it rather than adding another
