# Design: each-outlet-chooses-how-it-serves

## Context

What this change stands on, checked against the code on 2026-09-26:

- **An outlet row is written by the owner alone.** `outlets_update` refuses
  everybody else, and the isolation suite proves it by hand-crafted request.
  Managers read their own outlets' rows.
- **Lines are `order_items` / `bill_items`.** `menu_item_id` is nullable. A new
  line carrying a `menu_item_id` is checked by the command boundary against the
  menu's **current** name and price at that outlet
  (`20260903000002_the_boundary_accepts_both_shapes.sql`). A line with no menu
  id is not checked against anything. Each line carries `discount_paise`,
  `discount_percent_bp` and `category_name` for the menu discount (#53), bounded
  by `discount_paise <= line_total_paise`.
- **The totals identity is written in three places**: the check constraints,
  `billTotals()`, and `billing_validate_totals`. `lint:totals` and
  `lint:discount-rows` hold them to shared case tables.
- **The order number arrives when it arrives.** It is allocated by the server,
  so an order rung offline shows the *shape* of a number until it syncs.
- **#57 snapshots `customer_tier` on orders and bills on the server**, from the
  membership history at the moment of sale. The payload carries no tier. The
  tablet draws the star from what it was last told about the customer, including
  from the resume record.
- **Several tablets may bill at one outlet (#35)**, and ordinary order actions
  stay on the owning tablet. The pipeline is one outlet-wide list (#55), and a
  tablet remembers it for offline use without owning the others' orders.
- `BILLING_COMMAND_SCHEMA_VERSION` is 2 (`shared/billing-command.ts`), and the
  boundary accepts both the pre-discount and the discount payload shapes.

## D1. The settings are columns on `outlets`

```
dine_in_offered          boolean  not null default false
takeaway_offered         boolean  not null default false
service_type_optional    boolean  not null default true    -- "Can skip"
table_count              smallint null  check (between 1 and 99)
packaging_mode           enum ('off','per_bag','per_order') not null default 'off'
packaging_price_paise    integer  null
packaging_free_for_gold  boolean  not null default false
```

Checks, each stated in the table so a hand-crafted request meets it:

- `table_count` is null unless `dine_in_offered`.
- `packaging_price_paise` is null when `packaging_mode = 'off'`. Otherwise it is
  a whole number of rupees (a multiple of 100) from ₹1 to ₹500. Whole rupees,
  because every bill already ends on a whole rupee and a 50-paise bag would only
  feed the rounding line.
- `packaging_free_for_gold` is false when `packaging_mode = 'off'`.

The **ORDERS** master switch is derived, not stored: it reads *on* while either
type is offered. Turning it on in the UI sets both to offered. Turning it off
clears both and nulls `table_count`. One stored truth, no switch that can
disagree with what sits under it.

**Every existing outlet takes the defaults, which are all off.** Production bills
exactly as it did the moment before the migration.

## D2. Orders and bills carry how they were served

```
orders.service_type   enum ('dine_in','takeaway') null   -- null = neither
orders.table_number   smallint null check (between 1 and 99)
bills.service_type    same, copied from the order, or from a direct sale's own payload
bills.table_number    same
```

`table_number` is null unless `service_type = 'dine_in'`. Both are **snapshots**,
like the tier and the lines. They record what was chosen when the order was
rung, and no later settings change rewrites them. Both may change on a revision
while the order is open. Both are fixed at payment, like everything else on the
order.

The daily order number is **still allocated for every order**, table or not. A
table is what the counter *calls* the order. It is not its identity, and history,
voids and every manager surface go on working by order and bill number.

## D3. Packaging is a line, of its own kind

```
order_items.kind  enum ('item','packaging') not null default 'item'
bill_items.kind   same
```

A packaging line has `kind = 'packaging'`, no `menu_item_id`, the name
*Packaging* in both modes (owner, 2026-09-26), `unit_price_paise` = the
outlet's price, and `quantity` = bags (per bag) or 1 (flat). At most one
packaging line per order, enforced by a partial unique index on
`(order_id) where kind = 'packaging'` and its bill twin.

**Why a line.** A line is already snapshotted, already in the subtotal, already
reconciled by every guard, already on the receipt, and already removable by the
biller. The totals identity `total = subtotal − discount + tax + rounding` does
not move, so `lint:totals` holds without a new case. Packaging reaches the Ledger
through bill totals like any other sale, and the `kind` column means a later
report can separate it.

**What reaches a packaging line's price.** A bill-level discount (the biller's
keypad, #53) is computed against the subtotal, which includes packaging. That is
unchanged and accepted: a 10% discount on a ₹245 order takes 50 paise of it off
the bag, which rounding absorbs. A **menu discount can never reach a packaging
line**, because menu discounts attach by category and a packaging line has none.

## D4. The gold waiver is the packaging line's own discount

When the outlet waives packaging for gold members and the order's customer is a
member **as far as the tablet knows**, the packaging line carries
`discount_paise = line_total_paise` and `discount_percent_bp = 10000`.

- **It is attributable.** On a `kind = 'packaging'` line, a discount *is* the
  waiver. Nothing else can put one there (D3), and the boundary refuses any
  other value (D8). *"Packaging given free to gold members this month"* is one
  sum over stored rows.
- **It uses the discount machinery that exists.** The parts-equal-the-whole
  triggers, the payload reconciliation and the cap at the subtotal already cover
  line discounts, and the receipt already renders one.
- **It follows the customer while the order is open.** A menu discount is
  captured when its line is created (#53), because the menu can change under
  it. The waiver is different: it is *about* the customer, and the customer is
  routinely identified after the first bag is on the bill. So the waiver is
  re-derived on every revision from the order's current customer and the
  outlet's setting at that moment. Once the order is paid it is fixed.
- **The tablet decides, and the server does not second-guess it.** #57's
  server-side tier snapshot answers *was this customer gold at the moment of
  sale*. The tablet answers from what it was told. The two can disagree only
  when a grant or revocation races a sale, and refusing a paid sale over a
  ₹5 bag would strand the money. The bill keeps both facts, the tier as the
  server resolved it and the waiver as the counter applied it, and a reader who
  cares can compare them.

## D5. A table is unique at the counter, never at the database

The counter draws a table busy when any **open** order at this outlet, in the
pipeline the tablet can see (live or remembered), carries it. Tapping a busy
table opens that order, if this tablet owns it, to add lines. If another tablet
owns it, the counter says *Table 4 is open on the other tablet*, and that tablet
is where it is added to. This is the ownership rule #35 already enforces.

**The database does not refuse a second open order on the same table.** Two
tablets, or one tablet that was offline, can each seat table 4 without having
seen the other. By the time the second command reaches the server, the food has
been served and possibly paid for. A unique index would refuse a real sale to
protect a label. Instead the pipeline shows both orders as *Table 4*, and the
biller sorts it out in the room, which is the only place it can be sorted out.

A table frees when its order is **paid or cancelled** (owner, 2026-09-26),
because that is when the order stops being open. A paid order still owed food
keeps showing *Table 4* on its pipeline card, so the kitchen knows where to take
it. "Free" only means a new order may take the number.

Lowering `table_count` below a number in use strands nothing. The open order
keeps its table, and the popup simply stops offering the number to new orders.

## D6. How the settings reach the counter

- The counter reads its outlet's settings with the menu, on the same refresh
  path, and a running tablet picks up a change at its next menu refresh. Check
  whether the device session already reads its own `outlets` row. If it cannot,
  add a narrow security-definer read returning exactly these columns for the
  device's own outlet. Do **not** widen the device's grant on `outlets`.
- The settings are written into the **resume record** (#34), so a cold-started
  offline tablet serves the way its outlet does.
- Lines already captured keep their price. A packaging price change reaches new
  orders, and reaches a revision only through a packaging line that the revision
  adds. It never reprices an existing one.

## D7. The payload, version 3

The order and payment content payloads gain `service_type`, `table_number` and,
per line, `kind`. `BILLING_COMMAND_SCHEMA_VERSION` becomes 3. **The boundary
accepts versions 1, 2 and 3**, treating the earlier shapes as *neither, no
table, every line an item*, exactly as #53 treated the pre-discount shape. A till
holding queued work across this release settles it exactly once. The canonical
JSON and hash are proved across runtimes by new shared vectors for the v3 shape,
and the existing vectors keep passing.

## D8. What the boundary validates

**Service facts are checked for shape, never against the current settings.**
`service_type` must be one of the enum or null, `table_number` in range and only
with dine-in. Whether the outlet *currently offers* dine-in is **not checked**.
An offline tablet may have captured the order before the owner changed the
setting, and settings are how the counter behaves, not a money rule.

**A packaging line is checked the way a menu line is checked, and for the same
reason.** A new `kind = 'packaging'` line must carry the outlet's current
`packaging_price_paise` and the name *Packaging*, with no
`menu_item_id` and no category. An existing one is compared by identity, exactly
as `order_items` already are. This means a packaging price change **races an
offline tablet in exactly the way a menu price change already does**, with
whatever that path does about it. The implementing session reads that path and
applies the same rule, so the two do not diverge. It records in
`docs/LIMITATIONS.md` what the rule is.

**A packaging line's discount is the whole line or nothing.** Any other value,
and any discount on an item line that claims `discount_percent_bp = 10000`
without a category, is refused as malformed.

**At most one packaging line**, refused otherwise.

## D9. The counter

```
┌ Composer ─────────────────────────────────────┐
│ [ Riya ⭐ ]   ( Dine-in · Table 4 ) ( Takeaway )│  ← chips only when offered
│───────────────────────────────────────────────│
│ 2 × Chicken shawarma                   ₹240   │
│ Packaging  ( − ) 1 ( + )          ₹5  Free    │  ← takeaway, gold, waiver on
│───────────────────────────────────────────────│
│ Total                                  ₹240   │
└───────────────────────────────────────────────┘

Tapping Dine-in at an outlet with tables opens:
┌ Which table? ─────────────────────┐
│  ( 1 ) ( 2 ) ( 3 ) ( 4 )          │
│  ( 5 ) ( 6 ) ( 7 ) ( 8 )          │  busy: dimmed, tap = open that order
│                    [ No table ]   │
└───────────────────────────────────┘

Pipeline card:  Table 4  ·  2 items  · [Prepared] [Paid]
                (replaces #105; the number is not shown beside it)
```

- The chips never block. With *Can skip* on, nothing need be chosen. With it
  off, the order **starts on the first offered type**, so the common case costs
  no tap and the order is never *neither*.
- **Tables open in a popup** (owner, 2026-09-26), built the way the customer
  keypad dialog opens, so the composer stays the height it is today. Tapping
  *Dine-in* at an outlet with tables opens it. Choosing a table closes it and the
  chip reads *Dine-in · Table 4*. Tapping that chip again reopens it to change the
  table. *No table* closes it with dine-in chosen and no table.
- With no table chosen, a dine-in order is called by its number as today. A
  table is offered, not required.
- Where an order has a table, *Table 4* **replaces** the order number on every
  counter surface (owner, 2026-09-26). The number is not shown beside it.
- The packaging line sits **last** among the lines, always, so the food reads
  first.

## D10. Demo first, and the live counter unchanged until section 5

Section 1 builds all of this against the mock adapter with two demo outlets: one
with every switch on and one with every switch off. The **live** settings adapter
returns all-off until section 5 swaps it. So the counter in production renders
exactly what it renders today while the demo is walked and reworked, and the
new settings sections are gated `demo` on the Outlets page until then.

## Money arithmetic

- Packaging price: integer paise, a whole number of rupees, ₹1 to ₹500, stored
  on the outlet and snapshotted on the line. Per bag: `unit × bags`. Flat:
  `unit × 1`. Existing line arithmetic constraints apply unchanged.
- Waiver: `discount_paise = line_total_paise`, bounded by the existing
  `discount_paise <= line_total_paise` check. It counts in the parent's discount
  exactly as a menu line discount does, and is inside the existing cap at the
  subtotal.
- No new term in the totals identity. `lint:totals` needs no new case.
  `lint:discount-rows` gains a waiver case (a full-line discount on a packaging
  line, alongside a bill discount) so its arithmetic is pinned in both runtimes.

## RLS

- **No new table.** The new columns sit on `outlets`, `orders`, `order_items`,
  `bills` and `bill_items`, whose policies already scope them. They are covered
  by the isolation suite by *extension*, not by assumption: a neighbouring outlet
  and every non-owner principal are refused a write to the settings columns, and
  a neighbouring outlet cannot read another's service facts.
- The owner alone writes the settings, through the existing `outlets_update`. No
  path is added for a manager (proposal, Non-goals).
- The device's read of its own settings (D6) returns its own outlet's row and
  nothing else, proved by a device of the other outlet.

## Offline

- Settings travel in the resume record (D6).
- Service facts and packaging lines ride the existing command queue in the v3
  payload (D7). An order rung offline for table 4 with two bags and a gold waiver
  settles exactly once on reconnect.
- The busy-table view offline is the remembered pipeline, so it can be stale.
  D5 is what makes that safe.
- **A dine-in order with a table needs no order number to be called**, so the
  unsent-number shape (`the-order-number-arrives-when-it-arrives`) stops mattering
  for exactly the orders that have a table.

## Rejected alternatives

- **Packaging as a menu item the biller taps.** It would not be automatic, it
  could not be waived for gold without a rule reaching into the menu, and it
  would count bags as food in any menu report. The owner's "like an item" is
  kept where it matters: a bag is a line with a quantity.
- **Packaging as a bill-level charge column, beside rounding.** It adds a term
  to the totals identity in three places plus both lint tables, and every reader
  that adds up a bill, for a fact a line already carries for free.
- **Gold: leave the packaging line off entirely.** It is simpler, and it throws
  away the one number #57 said could never be recovered later: what gold cost.
- **Gold: a new `membership` discount source.** It is the hedge #57 cut. It
  needs a new enum, a payload field, both runtimes' discount-row cases and a
  receipt renderer change in another repo, to say what `kind = 'packaging'`
  already says.
- **A unique open-order index on `(outlet, table)`.** D5: it refuses real sales
  to protect a label.
- **Settings in their own 1:1 table.** It needs another policy and another
  isolation case to hold seven columns, when the outlet row is already scoped,
  already owner-written, and already read by everyone who needs these.
- **Checking service facts against the current settings at the boundary.** D8:
  it refuses offline work over a UX preference.
- **Making the choice mandatory by blocking Mark Paid until it is made.** The
  counter never blocks. Starting on the first offered type gives the same
  "never neither" with no tap.
- **Letting a Franchise Admin edit these now.** It is a new write path on the
  owner's row with no franchise yet asking. Proposal, Non-goals.
- **The table grid inline in the composer.** It was the first sketch. The owner
  chose a popup, and it also keeps the composer from growing by two rows at
  eight or more tables.
- **_Bag_ as the per-bag line's name.** The owner chose *Packaging* for both
  modes, so the line reads the same whichever mode an outlet uses.

## Owner decisions

Settled 2026-09-26, before the proposal was written: gold waiver yes; aggregator
never; one bag to start; a table frees on payment.

Settled 2026-09-26, after reading the proposal. These were the four questions
left for the checkpoint, and they are now answered. The checkpoint still has to
settle the UI as a whole.

1. **The line is called *Packaging* in both modes.** Per bag it reads
   *Packaging × 2*; flat it reads *Packaging*. There is no *Bag*. D3 and D9 are
   written to this.
2. **Tables open in a popup**, not inline in the composer. D9 is written to this.
3. **_Table 4_ replaces the order number** on every counter surface that would
   have shown it. It does not sit beside it. D2 is unchanged: the number is still
   allocated and stored, and history, voids and manager surfaces still identify
   the order by it.
4. **A manager sees these settings, read-only, for the outlets they manage and
   no others.** That is the existing read scope of an outlet row (a Franchise
   Admin reads the outlets their assignments name), so no policy changes. The
   sections render with their current answers and no controls.
