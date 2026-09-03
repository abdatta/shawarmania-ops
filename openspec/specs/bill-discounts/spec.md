# Bill Discounts

## Purpose

What a discount **is** in this system: a fact recorded beside the price it
reduces, never folded into it.

Two rules carry the rest. A line always snapshots its list price, so a bill
settled months ago reports the same reduction over the same categories at the
same basis it charged, with no reference to a menu that has since changed.
And every bill ends on a whole rupee, rounded up on its own stated line and
never below ₹1, so a fully discounted meal is a ₹1 bill that appears in the
day's takings rather than a nought that disappears from them.

Discounts arrive from two sources — the outlet's menu, attached to each line
they reach, and the biller, standing alone against the bill — combine
additively against gross, cap at the subtotal, and are attributed to the
person and the till that applied them. Once a bill is settled its discount is
history; the correction is a void and a new bill.

## Requirements

### Requirement: A discount is recorded beside the price it reduces, never folded into it

A discount SHALL NOT alter the `unit_price_paise` a line snapshots. Lines SHALL
continue to capture list prices, and every reduction SHALL be stored as its own
fact carrying the basis that produced it.

Every discount SHALL record, at the moment of sale and never by later reference to
the live menu: its source (a menu discount or a discount on this bill), its basis
(a percentage or an amount in rupees), the value in that basis, and the resulting
integer paise.

A percentage SHALL be stored in basis points as an integer, so that a fractional
percentage is representable and no float enters the money path.

#### Scenario: A bill is read months later

- **WHEN** a settled bill carrying a menu discount is opened long after the
  discount that produced it was turned off or changed
- **THEN** it reports the same reduction, over the same categories, at the same
  percentage it charged, with no reference to the current menu

#### Scenario: A price rises after the sale

- **WHEN** an item's price is changed after a discounted bill was settled
- **THEN** that bill's subtotal, discount and total are all unchanged

### Requirement: Menu discounts attach to the line and bill discounts stand alone

A menu discount SHALL be recorded on each order or bill line it reduces, carrying
that line's own resulting paise and the percentage applied, or no percentage where
the basis was an amount in rupees.

A discount applied to the whole bill SHALL be recorded as its own record against
the order or bill, because it belongs to no line and there MAY be several.

A line's recorded discount SHALL NOT exceed that line's own total.

The parent's stored discount SHALL always equal the sum of its lines' discounts
and its own bill-level discount records, enforced at the database rather than
computed by any reader.

#### Scenario: Which item was discounted

- **WHEN** a bill carrying a category discount is inspected
- **THEN** each line the discount reached reports its own reduction and the
  percentage that produced it, and lines outside the category report none

#### Scenario: The parts must equal the whole

- **WHEN** a discount record is written that would leave the parts disagreeing
  with the stored total discount
- **THEN** the database refuses the whole transaction

### Requirement: A line captures its discount when the line is created

A line SHALL capture the discount terms in force at the moment it is created, in
the same way and for the same reason it captures its item name and unit price.

Changing or ending a menu discount SHALL NOT alter any line already captured. When
an unpaid order is reopened and revised, lines already on it SHALL keep the terms
they captured, and lines added during that revision SHALL take the terms in force
at that moment. A discount applied to the bill SHALL survive a revision untouched.

#### Scenario: A discount ends while an order waits to be paid

- **WHEN** an order is saved under a menu discount, the discount is then turned
  off, and the order is paid afterwards
- **THEN** the order is paid at the total it was saved at, with the discount intact

#### Scenario: An order is edited after the discount ends

- **WHEN** that same order is reopened and another item is added
- **THEN** the lines already on it keep their captured discount, the new line
  carries none, and any discount applied to the bill is unchanged

### Requirement: Discounts combine additively against gross, and cap at the subtotal

Every discount SHALL be computed against the gross total of its own scope: a
category discount against the lines in that category, a bill discount against the
bill's subtotal. The results SHALL then be summed.

The order in which discounts are applied SHALL NOT change the outcome.

A discount in rupees SHALL apply per unit and SHALL multiply by the line's
quantity.

The summed discount SHALL be capped at the subtotal, so that no bill's discount
exceeds what it discounts and no total is ever negative.

#### Scenario: A percentage and an amount together

- **WHEN** a 15% menu discount and a ₹50 bill discount both apply
- **THEN** both are computed against gross, summed, and the result is the same
  whichever was applied first

#### Scenario: An amount against a quantity

- **WHEN** a ₹20 per-item discount reaches a line carrying three of that item
- **THEN** the line's recorded discount is ₹60

#### Scenario: Discounts exceed the order

- **WHEN** the discounts applied to a bill total more than its subtotal
- **THEN** the stored discount is the subtotal, and the total before rounding is
  nought

### Requirement: Every bill ends on a whole rupee, rounded up on its own line

A bill's total SHALL always be a whole number of rupees.

The difference between the discounted amount and that whole rupee SHALL be stored
as an explicit rounding amount on the order and the bill, SHALL always be in the
business's favour, and SHALL NOT be derived at read time.

The stored arithmetic identity SHALL be
`total = subtotal − discount + tax + rounding` on every order and every bill, and
SHALL be enforced by the database.

A bill SHALL never total less than one rupee. Where the discounted amount is below
that, the rounding amount SHALL carry the total up to it.

#### Scenario: A percentage produces paise

- **WHEN** a discount leaves an order at ₹330.65
- **THEN** the bill stores a rounding of ₹0.35 and totals ₹331

#### Scenario: The amount is already whole

- **WHEN** a discount leaves an order on an exact rupee
- **THEN** the stored rounding is nought and the total is that amount

#### Scenario: Everything is discounted

- **WHEN** an order is discounted in full
- **THEN** the discount records the whole amount given away, the rounding carries
  the total to ₹1, and the bill settles through the ordinary tender path

### Requirement: A discount is attributed, and belongs to the till that owns the order

Every discount SHALL be attributed to the till, shift and operator that applied
it, through the same command attribution every other billing write carries.

A discount SHALL be applied, edited or removed only from the till that owns the
order, and the database SHALL refuse it from any other, in the same way it refuses
every other ordinary action on another till's order.

A discount applied by a menu discount SHALL NOT be editable or removable at the
counter by any operator.

#### Scenario: The neighbouring till

- **WHEN** an operator at one till attempts to discount an order taken at the
  other till at the same outlet
- **THEN** the control is refused locally and the database refuses a hand-crafted
  request

#### Scenario: A biller and the owner's discount

- **WHEN** a menu discount appears on the order in front of a biller
- **THEN** it is shown with no control to change or remove it

### Requirement: A settled bill's discount is fixed, and correction is a void

A discount SHALL NOT be added to, changed on, or removed from a bill after it is
settled. Tender correction SHALL continue to reallocate a fixed total and SHALL
NOT change one.

A bill settled with the wrong discount SHALL be corrected by voiding it and
ringing it again, which is the existing path for every other kind of wrong bill.

#### Scenario: A discount is wrong after payment

- **WHEN** an operator attempts to alter the discount on a settled bill
- **THEN** no path accepts it, and the database refuses a hand-crafted request

#### Scenario: Tender is corrected on a discounted bill

- **WHEN** the tender on a discounted bill is corrected inside its window
- **THEN** the allocations change, and the subtotal, discount, rounding and total
  are all unchanged
