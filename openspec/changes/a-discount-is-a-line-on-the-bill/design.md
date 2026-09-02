## Context

The owner discounts orders today and has nowhere to record it. Two shapes, from
their own description: **per bill** at the counter (a regular, a remake, a
friend), and **per menu** across categories for a stretch of days.

### What already exists, and is only being connected here

- `orders.discount_paise` and `bills.discount_paise`, `not null default 0`,
  `check (discount_paise >= 0)`, both inside
  `check (total_paise = subtotal_paise - discount_paise + tax_paise)`.
- `discountPaise` on `OrderContentPayload` and `PayNowPayload`, validated by
  `billing_validate_totals` and typed by `billing_content_payload_well_typed`.
- `billTotals()` in `src/domain/billing.ts`, which already takes a
  `discountPaise` option and already refuses one larger than the subtotal.
- `pay_order` already validates the **stored** order arithmetic
  (`v_order.total_paise <> v_order.subtotal_paise - v_order.discount_paise + …`),
  so an order carrying a discount pays correctly with no change to that path.
- Drawer expectation reads `effective_bill_payments`, so a discounted bill
  already lowers expected cash with nothing to do.

### What actually stands in the way

Four things, and only the first is hard.

1. **The arithmetic identity is written in three places that must agree** — the
   check constraint on `orders` and `bills`, `billTotals()`, and
   `billing_validate_totals` in SQL. Adding the rounding term means editing all
   three in one change. A drift between them does not fail a test; it refuses
   live bills at the counter.
2. **`billing_payload_has_keys` is an exact key-set match**, so adding a key to a
   content payload rejects every payload already sitting in a till's outbox.
   Since #34, a till may legitimately hold days of them.
3. **#35 restated the no-discount requirement on 2026-09-02** and has not
   archived, so the requirement this change reverses currently exists in two
   versions.
4. **`payment_dialog` disables its confirm on `totalPaise <= 0`**, and
   `bill_payments` requires at least one allocation of more than zero paise. A
   free meal has to become a bill somebody can settle.

## Goals / Non-Goals

**Goals.** A discount that is a stored fact with its own basis, readable off a
three-month-old bill without the menu. Two places to set one. A whole-rupee total.
A day and a month that say what was given away.

**Non-goals.** Recorded in `proposal.md` and not repeated: no biller ceiling, no
reason codes, no date windows, no item-level configuration, no post-settlement
discount, no aggregator discounts, no printed receipt.

## Decisions

### A discount is recorded beside the price, never folded into it

The alternative was to let a menu discount lower the price the grid shows and the
line snapshots: 15% off makes ₹139 into ₹118.15, the line stores ₹118.15, and
`discount_paise` stays zero. It is genuinely less work.

**Rejected, because it answers no question afterwards.** The subtotal becomes net,
the reduction is nowhere, and the month simply shows less money with no way to
attribute it. The single thing an owner wants to know about a discount is what it
cost, and that model destroys the information at the moment of sale, permanently
and unrecoverably.

So list prices stand. Every reduction is a stored line carrying the basis that
produced it.

### The arithmetic, in full

```
subtotal = Σ line_total_paise                       (gross, list prices)
discount = Σ line discounts + Σ bill discounts      (capped at subtotal)
net      = subtotal − discount                      (≥ 0 by the cap)
total    = max(100, ceil_to_rupee(net))             (whole rupees, floor ₹1)
rounding = total − net                              (0 ≤ rounding ≤ 100)
```

and the stored identity on both tables becomes

```
total_paise = subtotal_paise − discount_paise + tax_paise + rounding_paise
```

Four properties are worth stating because each one was a decision:

- **Every discount computes against the gross base of its own scope**, then they
  are summed. Additive, not sequential: 15% and 10% is 25% off the original, not
  23.5%. The consequence that matters is **order independence** — the sequence a
  biller taps things in cannot change the total, which removes an entire class of
  "it came to something different last time".
- **A percent is stored in basis points** (integer, `1500` is 15%), so 12.5% is
  representable and no float ever enters the money path.
- **A rupee discount is per unit and multiplies by quantity.** ₹20 off a Paneer
  Roll with three on the bill is ₹60 [owner, 2026-09-03]. Percentages scale with
  quantity on their own; a rupee amount that did not would be the odd one out.
- **The discount is not rounded. The bill is.** The owner's instruction, and it is
  the better model: rounding the discount would contaminate the giveaway figure
  with rounding noise, whereas a rounding line leaves the discount exactly true
  (`₹58.35` is what the promotion cost) and puts the roundings in their own tiny
  pile, where they are income.

### Rounding is a line, stored, and always away from the customer

`ceil` and never `round`, so the business is never the one giving up the paise.
Stored rather than derived on read, for the same reason every other money fact in
this schema is stored: a constraint can check a column, and a bill that carries
its own rounding explains itself without anybody re-running the arithmetic that
produced it.

**Two constraints this lifts.** Menu prices no longer need to be whole rupees, so
[`docs/BUSINESS_CONTEXT.md`](../../../docs/BUSINESS_CONTEXT.md)'s round-rupee claim
goes and nothing has to enforce it. And the tender keypad still needs no decimal
point, because every total it is ever handed is now a whole rupee — which is why
`payment-dialog.tsx` keeps its `00` key and is otherwise untouched by this change.

### The ₹1 floor is carried by the rounding line, not by capping the discount

A hundred percent discount is allowed. The tempting alternative was to cap the
discount at `subtotal − ₹1` so the total lands on ₹1 with no rounding, and it is
worse: the stored discount would then read ₹138 on a ₹139 giveaway, and the
month's total would be quietly short by a rupee per free meal.

Instead the discount records the full ₹139 and the rounding line carries the total
back up to ₹1. The identity still balances. This is the only case where
`rounding_paise` reaches 100 rather than staying under it, which is why its check
is `between 0 and 100` rather than `< 100`.

A free meal is therefore a ₹1 bill, settleable through the existing tender path
with a ₹1 allocation, needing no change to `bill_payments`, no zero-tender branch,
and no exception in `payment_dialog`. The owner's own reason for wanting it this
way: a day reading ₹14,001 says at a glance that one went out.

### Menu discounts attach to the line; bill discounts get a child table

Two sources, two storage shapes, because they answer different questions.

**A menu discount attaches to `order_items` / `bill_items`**, as
`discount_paise` plus `discount_percent_bp` (null when the basis was rupees, in
which case the per-unit amount is `discount_paise / quantity`). This is what makes
"which item was discounted, and by how much" answerable off the bill itself, which
the owner asked for explicitly so that menu history never has to be consulted. It
also makes the line the unit of snapshotting, exactly as `item_name` and
`unit_price_paise` already are: **a line captures its discount when it is created**,
so ending a discount does not rewrite the order it is already on, and re-opening an
order for edit leaves captured lines alone while new lines take today's terms.

**A bill discount gets `order_discounts` / `bill_discounts`**, because it belongs
to no line and there may be several. Modelled directly on `bill_payments`, which
solved the same problem for split tender: append-only, insertable only through a
billing command, and guarded by a constraint trigger asserting the children plus
the line discounts sum to the parent's `discount_paise`. Columns are the basis, the
value in its own unit, and the resulting paise. **No name and no free text** — the
owner was explicit that a discount does not need naming.

**`category_name` is snapshotted onto the line** in the same migration. It is what
lets a settled bill render `Menu Discount (15%)` over `Shawarma, Rolls` months
later, and it obeys the rule the rest of the line already obeys: a bill is never
valued or described by joining the live menu.

### Grouping is a rendering rule over the lines, not a stored grouping

The panel shows one row per distinct menu-discount value, with the categories it
covered as subtext. Three cases, in order:

- Every category in the outlet's menu is covered → subtext reads `All Items`.
- Several categories share one value → one row, subtext lists them.
- Different values → a row each.

Derived at render time from the lines, so nothing needs storing to support it and
a bill with a strange mix cannot produce a row that disagrees with its own lines.

### Menu discounts are configuration, and live where the menu lives

`menu_discounts` (outlet, basis, value, active) with `menu_discount_categories`
joining to `menu_categories`. Several may be active at once over different
category sets at different values, added one at a time through the dialog, which
is what the owner asked for.

**They ride the menu read.** The counter already refreshes its menu on two
independent triggers — returning to the foreground, and a change reported by the
backend — and already persists the menu into its resume record so an offline cold
start can still bill. Making the discounts part of that same payload means both
tills pick a change up through a path that is already proved, and an offline till
sells under the discounts it last saw rather than at full price. A separate fetch
would have been a second thing to keep current and a second thing to forget
offline.

### A rupee menu discount is bounded by the cheapest item it reaches

`value_paise ≤ min(price_paise)` over every item in every selected category,
enforced by trigger in both directions: on writing the discount, and on repricing
an item that an active rupee discount already reaches [owner, 2026-09-03].

Not merely tidiness. A per-unit rupee discount larger than the price drives the
line's own discount above its `line_total_paise`, which is nonsense before it is
ever a total, and would corrupt the per-line attribution the whole reporting story
rests on. The line therefore also carries
`check (discount_paise <= line_total_paise)` as the backstop.

Percent discounts need no such rule: a percentage of a price is never larger than
the price.

### Presets are an array on the outlet

Between zero and four percent presets, ordered, defaulting to 10 / 15 / 20. Stored
as `outlets.discount_preset_bp integer[]` with a length check, rather than as a
table.

**A table was the more conventional answer and is the wrong one here.** These are
read and written whole, always with the outlet, never queried by element and never
joined to. A table would add a migration, a policy, an isolation-suite case and an
adapter for a list of at most four integers that nobody will ever filter on. The
upper bound of four is a layout fact: the biller's panel fits four across one row,
and a preset row that wraps is worse than one preset fewer.

### The panel

Opens from **Add discount**, below the lines in the composer column, and is built
from the same parts as Mark Paid so the counter learns one interaction and not two.

```
┌────────────────────────────────────────────┐
│  Add discount                              │
│                                            │
│              ┌──────────────┐              │
│              │     15%      │   ← readout  │
│              └──────────────┘              │
│                                            │
│   [ 10% ]  [ 15% ]  [ 20% ]                │
│   [    %    ]  [    ₹    ]                 │
│                                            │
│      ┌───┬───┬───┐                         │
│      │ 1 │ 2 │ 3 │                         │
│      │ 4 │ 5 │ 6 │                         │
│      │ 7 │ 8 │ 9 │                         │
│      │ . │ 0 │ ⌫ │                         │
│      └───┴───┴───┘                         │
│                                            │
│   [    Back    ]  [     Apply     ]        │
└────────────────────────────────────────────┘
```

Five details, each of them the owner's:

- **The readout starts at `0` and shows the unit**, so the panel is never
  ambiguous about what is being typed.
- **`%` and `₹` switch on a tap without clearing the entry.** Typing `15` then
  tapping between the two is how somebody decides which they meant.
- **A decimal point replaces `00`.** `00` earns its place on a tender pad where
  amounts are round hundreds, and earns nothing here.
- **`0` sits centre, the decimal left, backspace right**, so the pad reads as a
  keypad rather than as a calculator.
- **No total is shown.** A discount is not set by aiming at a final amount, so a
  running total would be answering a question nobody is asking.

Presets render only if configured, zero through four, one row, never wrapped.

### The bill column

Discount rows sit with the items, because that is what they are to the person
reading the bill.

```
  Chicken Shawarma                    ₹139
    ₹139                    [−] 1 [+]

  Paneer Roll                         ₹250
    ₹125                    [−] 2 [+]
  ─────────────────────────────────────────
  Menu Discount (15%)              −₹58.35
    Shawarma, Rolls

  Discount (₹50)                      −₹50
    On this bill              [✎]  [🗑]
  ─────────────────────────────────────────
  Round up                           +₹0.35
  ─────────────────────────────────────────
  Total                                ₹281
```

The subtext uses the same treatment the unit price already has under an item name,
so the column has one visual grammar rather than two. **Menu rows carry no
controls at all** — they are the owner's, and a biller cancelling the owner's
discount for one customer is a decision rather than a keystroke. Bill rows carry
edit, which reopens the panel on that discount, and delete.

### Ownership, and the neighbouring till

#35 made an outlet able to run two tills over one kitchen rail, and a card from
the other till already renders with its actions disabled and its owner named.
Adding a discount is an ordinary order action and inherits that rule exactly: the
neighbouring till reads the discount and is refused the control, locally and at the
database, with no new predicate written for it.

### The payload, and work already queued

Content payloads gain `discounts` and `roundingPaise`, which changes their
canonical JSON and therefore their SHA-256 identity, and which the exact-key
validator would otherwise reject outright.

`BILLING_COMMAND_SCHEMA_VERSION` goes to **2**, and the boundary accepts **1 and
2**, where a version-1 payload means no discount lines and no rounding. Explicit
and self-describing, and it is the only reason a till that has been offline since
before the release still settles its day exactly once afterwards. The
cross-runtime hash vectors in `src/lib/billing-command.test.ts` gain a case for
each version, because the two halves of the canonical rule are allowed to disagree
in exactly one way and that is it.

## Risks / Trade-offs

- **The arithmetic identity moves, on live tables carrying production bills.**
  Mitigated by the term being additive with a zero default, so every existing row
  satisfies the new constraint unchanged, and by the migration asserting exactly
  that before it swaps them. Still the single most careful part of this change,
  and the reason it takes the full gate set rather than the quickfix lane.
- **No ceiling on a counter discount** is a cash-shrinkage surface, accepted
  knowingly by the owner. Attribution and the two reporting sections are what stand
  in its place, and they are also what would evidence the problem if it appears.
- **Additive stacking can reach 100%** through ordinary configuration — a 60%
  menu discount plus a 50% bill discount. It caps at the subtotal and floors at
  ₹1, so it cannot produce a negative bill, but it can produce a free meal by
  accident. The day's takings are where that shows, immediately.
- **`category_name` on every line** is a column added for what is mostly a
  display concern. Justified by the snapshot rule it obeys and by the alternative
  being a live menu join on historical bills, which this repo forbids outright.

## Migration Plan

One forward migration, in an order where no intermediate state is loose:

1. Add `rounding_paise` to `orders` and `bills`, defaulted zero, and assert every
   existing row satisfies the new identity **before** dropping and recreating the
   two arithmetic constraints.
2. Add `category_name`, `discount_paise` and `discount_percent_bp` to
   `order_items` and `bill_items`, with the per-line ceiling check. Backfill
   `category_name` where the menu still resolves it, and leave it null where it
   does not rather than guessing.
3. Add `order_discounts` and `bill_discounts` with their RLS policies, their
   command-only insert triggers and their immutability triggers, all modelled on
   `bill_payments`, plus the constraint trigger asserting lines and children sum
   to the parent's `discount_paise`.
4. Add `menu_discounts`, `menu_discount_categories` and their policies, plus the
   two price-floor triggers.
5. Add `outlets.discount_preset_bp` with its length and range checks.
6. Teach the command boundary version 2 while it still accepts version 1.

No drop, no rename, no data loss. Isolation-suite cases land with each new table
in the same change, per the standing rule.

## Resolved Questions

- **Biller discount ceiling?** No. Unlimited, capped at a ₹1 bill
  [owner, 2026-09-03].
- **Free meals?** Allowed, as ₹1 bills [owner, 2026-09-03].
- **Additive or sequential stacking?** Additive [owner, 2026-09-03].
- **₹20 off an item with three on the bill?** ₹60 [owner, 2026-09-03].
- **Round the discount or the bill?** The bill, upward, on its own line
  [owner, 2026-09-03].
- **Reason codes?** No.
- **Date windows on a menu discount?** No; on and off.
