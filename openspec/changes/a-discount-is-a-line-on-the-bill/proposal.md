# Proposal: A Discount Is A Line On The Bill

> **Model**: Opus · **Wave**: E · **Depends on**: #35, #52 · **Gate**: a biller adds a discount to the order in front of them from a keypad panel that opens the way Mark Paid does, in percent or in rupees, several times over, editing and removing their own and never the owner's; the owner sets a percent or rupee discount across any set of categories from the Menu screen, several such discounts at once, and every till selling under them picks them up without anybody reloading; each discount reads on the bill as its own line saying **what it was** — `Menu Discount (15%)` over the categories it covered, `Discount (₹50)` over `On this bill` — and stays readable that way for a bill settled three months ago with no menu history consulted; every bill ends on a whole rupee, rounded up on its own stated line, and never below ₹1, so a fully discounted meal is a ₹1 bill visible in the day's takings; a rupee menu discount cannot be set above the cheapest item it covers and that item cannot later be repriced beneath it, both refused by the database; the day and the month each report what was given away, so a promotion reads as a promotion and not as a slump; commands queued by a till before this change still settle exactly once afterwards; and the four-role demo walkthrough still walks

## Why

The owner runs discounts already. Some are per order at the counter — a regular
customer, a remake, a friend — and some are promotions across part of the menu for
a period. Neither has anywhere to go in this app, so both currently happen by not
ringing the sale up properly, which is the one thing a cash-counter app exists to
prevent.

**The schema has been waiting for this since day one.** `bills.discount_paise` and
`orders.discount_paise` exist, carry `check (discount_paise >= 0)`, and participate
in the arithmetic constraint on both tables. The command payloads already transmit
`discountPaise`. `billTotals()` already accepts it. All of it writes zero, because
[`docs/BUSINESS_CONTEXT.md`](../../../docs/BUSINESS_CONTEXT.md) recorded the reason:
*"exposing a dormant discount field would make a pricing and authority decision the
business has not made."*

The owner has now made it, on 2026-09-03. So the work is not the plumbing. It is
the model — what a discount **is** as a stored fact — the two surfaces that set
one, and the reporting that stops a promotion looking like a bad week.

**The decision that shapes everything else is that a discount does not rewrite a
price.** A menu discount could have made the grid show ₹125 where the item is
₹139, and the line would snapshot ₹125. That is simpler by one afternoon and
permanently destroys the only question worth asking about a promotion, which is
what it cost. So list prices stand, and the discount is recorded beside them as a
line of its own with its own basis. The bill explains itself, and the month can add
the lines up.

## What Changes

- **A discount is a recorded line, not a smaller price.** Lines keep their list
  price snapshots. Every reduction is stored with the basis that produced it —
  the percent, or the rupees per unit — so a bill settled today still says
  `Menu Discount (15%)` in three months without the live menu being consulted.
- **The counter gets an Add discount control**, below the lines in the composer
  column, opening a keypad panel built the way Mark Paid is: a big readout, a
  unit that switches on a tap rather than needing the entry cleared, between zero
  and four owner-configured percent presets on one unwrapped row, and a decimal
  point in place of `00`. Applied discounts then sit in the bill column as rows
  alongside the items, carrying edit and delete where an item carries plus and
  minus.
- **The owner sets menu discounts from the Menu screen**, through a **Set
  Discounts** dialog with a multi-select category picker and a select-all. Several
  may run at once at different values over different categories, added one at a
  time. Nothing is called a sale, a promotion or an offer anywhere in the product;
  the word is **Discount**.
- **Menu discounts are frozen at the counter.** A biller sees them on the bill and
  cannot edit or remove them. Their own bill discounts they may edit and remove
  freely.
- **Every bill ends on a whole rupee, and rounds up.** A percent of an odd
  subtotal produces paise, and nobody at this counter can be handed ₹330.65. So a
  **Round up** line is added last, always away from the customer, always stored
  rather than computed at read time, and the arithmetic constraint on both tables
  grows a term to hold it. Two constraints this removes elsewhere: menu prices no
  longer need to be whole rupees, and the tender keypad still needs no decimal,
  because every total it ever sees is a whole rupee.
- **A bill never falls below ₹1.** A hundred percent discount is allowed and
  records the full giveaway honestly; the rounding line carries the total up to
  the floor. A free meal is therefore a ₹1 bill, and a day reading ₹14,001 says at
  a glance that one went out.
- **A rupee menu discount is bounded by the cheapest item it covers**, refused in
  both directions: the discount cannot be set above that price, and an item cannot
  later be repriced below a rupee discount that already reaches it. Both at the
  database, not at the form.
- **The day and the month each gain a discounts section**, because revenue is
  going to fall and the figure alone does not say why. Sales stay net; the
  discount section supplies the context beside them.
- **A discount belongs to the till that owns the order.** The neighbouring till
  reads it and is refused it, by the ownership rule #35 already established.

## Capabilities

### New Capabilities

- `bill-discounts`: what a discount is as a stored fact — the two sources, the
  two bases, how several combine, the cap, the rounding line, the ₹1 floor, and
  the snapshot rule that keeps a settled bill readable without the menu.

### Modified Capabilities

- `counter-billing`: the composer offers a discount control, which reverses the
  requirement **#35 restated three days ago** — *"V1 SHALL offer no discount
  control, and both paths SHALL carry `discount_paise` as zero"* — and removes its
  `No discount is offered` scenario. **#35 must archive before this delta
  applies**, or the two changes edit one paragraph in opposite directions. The
  panel, the discount rows in the bill column, and the till ownership boundary
  arrive here too.
- `menu-management`: an outlet holds any number of active menu discounts, each
  over a chosen set of categories; a rupee one is bounded by the cheapest item it
  covers and binds later repricing; the counter picks changes up on the two
  triggers it already refreshes the menu on, and carries them into its offline
  snapshot; and the outlet's counter presets are configured here.
- `billing-command-contract`: content payloads carry their discount lines and
  their rounding, the totals validator learns the new term, and the boundary
  **accepts both the old and new payload shapes** so that work a till queued
  before this change still settles exactly once after it.
- `ledger-statement`: the day and the month each report what was given away, and
  state that sales are net of it.

## Impact

One migration adds the rounding term to `orders` and `bills` and rewrites their
arithmetic constraints, adds the per-line discount and category snapshot columns,
adds the bill-level discount child tables with the sum guard and command-only
insert path that `bill_payments` already models, and adds the menu discount
configuration with its price-floor triggers. `billTotals()` grows the rounding
line and the cap. The composer, the bill panel, the Menu surface, manager bill
detail and history, and the Ledger day and month all render the new lines.
Generated types, demo fixtures and the mock adapter follow.

**Nothing about tender, delivery, ownership, numbering or readiness changes.** A
discount moves the total before payment and is invisible to everything after it.

## Non-goals

- **A ceiling on what a biller may discount.** Raised as the reason the docs
  deferred discounts at all — an unbounded discount button on a shared counter is
  a way to take cash without touching the drawer. The owner considered it and
  declined: *"Yes, biller can discount as much as they like, bill amount capped at
  0"* [owner, 2026-09-03]. What remains in its place is attribution and
  visibility: every discount is stored with the till, shift and operator that
  applied it, and the day and month both report the total given away. If the
  reporting later shows a problem, the cap is a small change on top of this one.
- **Reason codes on a counter discount.** Offered and not taken, on the grounds
  that this should stay simple. The line records what was given and by whom, not
  why.
- **Dates on a menu discount.** The owner turns one on and turns it off. When
  scheduling is wanted it must key on the outlet's **business date** and not on
  `now()`, or a discount ending on the 31st will miss a bill rung at 00:30 on the
  1st that belongs to the 31st. Recorded here so that trap is not rediscovered.
- **Item-level menu discounts.** Discounts are set over categories. They are
  *recorded* per line, which is what makes a historical bill readable, but the
  thing the owner picks is a category.
- **Discounting a settled bill.** Tender correction reallocates a fixed total and
  cannot change one. A wrong discount is a void and a re-ring, which is the
  existing correction path for every other kind of wrong bill.
- **Discounts on aggregator orders.** Zomato and Swiggy discounts are theirs,
  arrive through settlement sync, and have nothing to do with this.
- **A printed or shared bill showing the customer what they saved.**
  [`openspec/todos/bill-thermal-printing.md`](../../todos/bill-thermal-printing.md)
  and [`openspec/todos/bill-digital-share.md`](../../todos/bill-digital-share.md)
  both remain where they are.
- Deposits, partial payment, refunds, loyalty, coupon codes, and GST.

## Docs to update before archive

`docs/BUSINESS_CONTEXT.md` — the discount paragraph and the round-rupee price
claim, both of which this change makes false. `docs/DATA_MODEL.md` — the bill
arithmetic invariant gains its rounding term. `docs/SCREENS.md`, `docs/TESTING.md`,
and `docs/LIMITATIONS.md`, which loses **No discounts or partial payment in
billing v1** and keeps the partial-payment half of it.
