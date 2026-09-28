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
table_numbers            boolean  not null default false
packaging_mode           enum ('off','per_bag','per_order') not null default 'off'
packaging_price_paise    integer  null
packaging_free_for_gold  boolean  not null default false
```

Checks, each stated in the table so a hand-crafted request meets it:

- `table_numbers` is false unless `dine_in_offered`. There is no count of tables
  [owner, 2026-09-27]: the biller keys the number, 1 to 999.
- `packaging_mode` is `'off'` unless `takeaway_offered` [owner, 2026-09-27]:
  packaging is charged on takeaway orders and nowhere else.
- `packaging_price_paise` is null when `packaging_mode = 'off'`. Otherwise it is
  a whole number of rupees (a multiple of 100) of at least ₹1, with **no upper
  limit** [owner, 2026-09-27]. Whole rupees, because every bill already ends on a
  whole rupee and a 50-paise bag would only feed the rounding line.
- `packaging_free_for_gold` is false when `packaging_mode = 'off'`.

The **ORDERS** master switch is derived, not stored: it reads *on* while either
type is offered. Turning it on in the UI sets both to offered. Turning it off
clears both, turns table numbers off and turns packaging off.

There is **no *Can skip*** [owner, 2026-09-27]. It was a column in the first
draft, `service_type_optional`, and was cut at the checkpoint: *neither* is
still a value an order records — at an outlet offering no type, and for
everything rung before these choices — but where the counter asks, it must be
answered (D9). One stored truth, no switch that can
disagree with what sits under it.

**Every existing outlet takes the defaults, which are all off.** Production bills
exactly as it did the moment before the migration.

## D2. Orders and bills carry how they were served

```
orders.service_type   enum ('dine_in','takeaway') null   -- null = neither
orders.table_number   smallint null check (between 1 and 999)
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

A table is busy when any **open** order at this outlet, in the pipeline the
tablet can see (live or remembered), carries it. **Keying a busy table is
refused, in red** [owner, 2026-09-27], the way an invalid mobile number is — *Table 4 is
already open.* with **Edit here.** beside it, or *…is open on Counter 2.* where
another tablet holds it — and more food for that table goes on its order from the rail. (The
first build opened that order from the table grid instead; the grid is gone.) An
order being edited is never refused its own table.

**The database does not refuse a second open order on the same table.** Two
tablets, or one tablet that was offline, can each seat table 4 without having
seen the other. By the time the second command reaches the server, the food has
been served and possibly paid for. A unique index would refuse a real sale to
protect a label. Instead the pipeline shows both orders as *Table 4*, each
marked with its place among the open orders there — *1 of 2* for the older,
*2 of 2* for the newer, in the warning fill [owner, 2026-09-27] — and the biller
sorts it out in the room, which is the only place it can be sorted out. A third
way in, besides two tablets and a stale offline pipeline: taking back the
payment on a table's order after the table was seated again.

A table frees when its order is **paid or cancelled** (owner, 2026-09-26),
because that is when the order stops being open. A paid order still owed food
keeps showing *Table 4* on its pipeline card, so the kitchen knows where to take
it. "Free" only means a new order may take the number.

Turning table numbers off strands nothing. An open order keeps its table; new
orders are simply not asked for one.

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
│ 2 × Chicken shawarma                   ₹240   │
│ Packaging  ( − ) 1 ( + )          ₹5  Free    │  ← takeaway, gold, waiver on
│───────────────────────────────────────────────│
│ Total                                  ₹240   │
│ (      Table 4      ) (     Takeaway      )   │  ← only where there is a choice
│ [ Riya ⭐ · +91 90000 00101 ]                 │
│ [ Order ]                          [ Paid ]   │
└───────────────────────────────────────────────┘

Tapping Dine-in at an outlet with table numbers opens:
┌ Which table? ────────────────┐
│          Table 12            │  ← red, with one line, if 12 is open
│      ( 1 ) ( 2 ) ( 3 )       │
│      ( 4 ) ( 5 ) ( 6 )       │
│      ( 7 ) ( 8 ) ( 9 )       │
│            ( 0 ) ( ⌫ )       │  ← no `.`, no `00`; three digits at most
│ [ No table ]     [ Done ]    │
└──────────────────────────────┘

Pipeline card:  Table 4  ·  2 items  · [Prepared] [Paid]
                (replaces #105; the number is not shown beside it)
```

- **The counter asks only where there is a choice** [owner, 2026-09-27]: both
  types offered, or dine-in with tables. At a takeaway-only outlet no chip is
  shown and every order is takeaway, with its packaging; at a dine-in-only
  outlet without tables, every order is dine-in with no table.
- **Where it asks, nothing is preselected and the answer is owed** [owner,
  2026-09-27]: Order and Paid wait for it, exactly as they wait for the customer
  decision. For dine-in with tables the answer is a table or *No table*, made in
  the popup. Tapping the chosen chip again takes a mistaken tap back, and the
  answer is owed again.
- **With tables, the dine-in chip reads the answer alone**: *Table 4*, or *No
  table* [owner, 2026-09-27].
- **The table is keyed on a number pad** [owner, 2026-09-27], built like the
  customer keypad: 1 to 999, never a leading nought, no decimal point and no
  `00`. A table already open is refused in red and *Done* stays disabled.
- **Tables open in a popup** (owner, 2026-09-26), built the way the customer
  keypad dialog opens, so the composer stays the height it is today. Tapping
  *Dine-in* at an outlet with tables opens it. Choosing a table closes it and the
  chip reads *Table 4*. Tapping that chip again reopens it to change the table.
  *No table* closes it with dine-in chosen and no table, and the chip reads *No
  table* [owner, 2026-09-27].
- With no table chosen, a dine-in order is called by its number as today. A
  table is offered, not required.
- Where an order has a table, *Table 4* **replaces** the order number on every
  counter surface (owner, 2026-09-26). The number is not shown beside it.
- The packaging line sits **last** among the lines, always, so the food reads
  first.

## D11. What production can count [owner, 2026-09-27]

The owner wants two numbers once this ships: how often two open orders shared a
table, and how many dine-in orders had no table.

- **Dine-in with no table** needs nothing added: `service_type = 'dine_in' and
  table_number is null`, over `orders` or `bills`, per outlet and business date.
  An order does not record whether its outlet had tables switched on at the
  time, so *No table* chosen and *no tables offered* read alike; read against the
  outlet's settings, which change rarely.
- **A shared table cannot be read back reliably.** An order stores its last
  table, not its history, and a payment taken back rewrites its paid time, so
  reconstructing who overlapped whom from open intervals misses a table changed
  mid-order and misses the case the owner found. So the boundary records it as it
  happens: **`orders.table_shared boolean not null default false`**, set on
  every order involved whenever a create, a revision or a payment taken back
  leaves two or more open orders at one outlet on one table. It is never unset,
  so it survives payment. Orders that shared: `count(*) where table_shared`;
  incidents: the same grouped by outlet, business date and table.
- Set by the server, in the same transaction as the write, so a collision made
  by two tablets or an offline one is counted when it syncs, not only when some
  tablet happens to see both. One column on a table already scoped by outlet:
  no new table and no new policy. It is telemetry about the order, never a
  refusal of it (D5).

## D10. Demo first, and the live counter unchanged until section 5

Section 1 builds all of this against the mock adapter with two demo outlets: one
with every switch on and one with every switch off. The **live** settings adapter
returns all-off until section 5 swaps it. So the counter in production renders
exactly what it renders today while the demo is walked and reworked, and the
new settings sections are gated `demo` on the Outlets page until then.

## Money arithmetic

- Packaging price: integer paise, a whole number of rupees, at least ₹1, stored
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
  and every principal other than the owner and that outlet's managers is
  refused a write to the settings columns, and a neighbouring outlet cannot read
  another's service facts.
- **The owner and the outlet's own managers write the settings** [owner,
  2026-09-27], through one narrow security-definer function —
  `set_outlet_service_settings(outlet, settings)` — which re-derives the
  caller's authority (`app_is_owner()` or `app_has_role_at('franchise_admin',
  outlet)`) and writes these six columns and nothing else. `outlets_update` is
  not widened: it stays the owner's alone for every other column, so a manager
  can never reach the cutover, the check-in fence or closing through this door.
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
  isolation case to hold six columns, when the outlet row is already scoped,
  already owner-written, and already read by everyone who needs these.
- **Checking service facts against the current settings at the boundary.** D8:
  it refuses offline work over a UX preference.
- **Starting an order on the first offered type, and a *Can skip* setting.**
  The first draft preselected a type so that the counter never blocked. The
  owner turned it down [2026-09-27]: a preselected type is recorded whether or
  not anybody meant it, so the answer is now owed where the counter asks, like
  the customer decision, and a one-type outlet is not asked at all.
- **Packaging as its own section, charged on every order that is not
  dine-in.** The first draft, meant for a parcel-only shop showing no chips. The
  owner put packaging inside Takeaway [2026-09-27]; that shop offers takeaway
  alone, and every order it rings is takeaway without a chip.
- **A ₹500 ceiling on the packaging price.** A typo guard with no unit to guard:
  the price is typed in whole rupees. Dropped [owner, 2026-09-27].
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
4. ~~**A manager sees these settings, read-only.**~~ Reversed on 2026-09-27:
   a manager **changes** them for the outlets they manage (round 1, item 15).

## Section 1 as built, for the checkpoint (2026-09-27)

Built against the mock only. Nothing below is settled until the owner walks it;
each item is a choice the sketches left open, made so the demo could be walked,
and each is cheap to change at the checkpoint.

**The settings page**

- **The section saves as one, with a Save that appears only once something in
  it has changed.** A switch shapes a draft rather than writing:
  turning packaging on needs a price the owner types, and a half-set section is a
  combination the database refuses (D1). Cancel puts back what is stored.
- **The table count and the price are typed**, as whole numbers, rather than
  stepped. Eight taps to reach eight tables was the alternative.
- **Taking dine-in away takes its tables with it**, and offering it again starts
  them off rather than bringing back a count nobody could see.
- **A manager gets the owner's editable section** for the outlets they manage (round 1, item 15). The read-only rendering is kept for a reader who may see the page and not write, which is nobody today.
- The section sits only on a **trading** outlet's page, as Tablets do.

**The counter**

- **The chips sit on a row of their own above the customer control** [owner,
  2026-09-27], sharing the panel's width equally.
- **Tapping *Dine-in* at an outlet with tables always opens the popup**, even
  when dine-in is already chosen: that is how a table is changed.
- ~~A busy table is dimmed with the word *open* under its number.~~ The grid
  is gone (round 2): a busy table keyed on the pad is refused in red, with a
  sentence, so the state is still not colour alone.
- **The counter never removes or reprices packaging** [owner, 2026-09-27]. A
  flat charge carries no control at all; per bag, − stops at one bag. Only
  marking the order something other than takeaway takes the line off.
- **The waiver reads *₹5* struck through over *Free***, and no *Menu discount*
  row appears for it: the line itself says what happened.
- **The pipeline card says *Takeaway* or *Dine-in* in its metadata line** where
  the order has no table, so the kitchen can tell a plate from a parcel (the
  first reason in the proposal). A table already says dine-in.
- **The kitchen ticket lists the packaging as a line** (*1× Packaging*), so
  whoever packs sees the bags.
- **Where a bill is read back** — Bills this shift and the manager's bill
  detail — a waived packaging line reads the same *struck price over Free*, the
  shift list shows *Table 4* in place of *Order 105*, and the manager's detail
  adds *Served: Dine-in · Table 4* beside the order and bill numbers.

**The demo and the seam**

- **Kalyani has chosen nothing and Kanchrapara everything** (both types, 8
  tables, ₹5 per bag, free for gold). Kalyani is where the demo's
  counter stands, so every walkthrough and every existing counter test starts on
  the counter as it bills today — which is itself the claim that an all-off
  outlet is unchanged — and the walkthrough's first step turns Kalyani's
  switches on before going to the counter. The first build had them the other
  way round; ten e2e counter cases asserting today's totals were what said so.
  No seeded order sits at a table: the walkthrough seats its own before it adds
  to a busy one.
- **The settings reach the counter on the menu read** (`OutletMenu.service`),
  which the resume record already persists whole, so D6's cold start needs no
  new storage. Absent reads as all-off, which is also what the live menu read
  returns until section 5.
- **The live outlets adapter reads all-off and refuses the write** (D10). The
  sections are gated by a new **part** gate, `outlet-service-choices`, in
  `src/gates/registry.ts`: the registry gated only whole surfaces by route, and
  these sit inside a live one. Section 5 promotes it with a one-line edit.
- The mock checks the payload shapes D8 describes (a table only with dine-in and
  in range, at most one packaging line, and a packaging line with no menu item,
  no category and a discount of nothing or all of it), refusing as
  `malformed`, so the demo cannot accept what the boundary will not.
- **One mock defect fixed on the way**: a direct *Paid* sale wrote its bill lines
  with every discount zeroed while the bill's total kept them, so the bill
  detail showed a gold member's packaging charged on a bill that had not charged
  it. The same defect hid a menu discount on a direct sale.

## Owner checkpoint, round 1 (2026-09-27)

The owner walked the settings page and changed it. Built in section 1 the same
day; the spec delta `service-and-packaging` is rewritten to match.

1. **Packaging lives inside Takeaway.** It is offered only while takeaway is,
   charged on takeaway orders and on nothing else — not on dine-in, and not on
   *neither*. The database refuses packaging without takeaway (D1), and ceasing
   to offer takeaway turns packaging off. The settings page is therefore one
   section, **Orders**, with one Save.
2. **Options nest inside their own tile**, not beside it behind an indent. Each
   level takes the other of the two surface tones from the one it sits in —
   card, raised tile, card-toned tile, raised tile — so what belongs to what
   reads from the shape.
3. **Flat per order is the first packaging option, and the default** when the
   charge is turned on.
4. **The counter asks only where there is a choice**, and **the answer is owed**
   where it asks: see D9. A takeaway-only outlet shows no chip and every order
   is takeaway; a dine-in-only outlet without tables shows none and every order
   is dine-in; dine-in with tables must be answered with a table or *No table*;
   both types offered preselects neither and must be answered.
5. **There is no *Can skip*.** Its only purpose was that *neither* exist, and it
   does — at an outlet offering no type. Six settings columns, not seven.
6. **No upper limit on the packaging price.** Whole rupees, at least ₹1.
7. **The chips sit above the customer control**, on a row of their own.
8. **The biller neither removes nor reprices packaging.** Editing the charge on
   an order was asked for and withdrawn the same day. D8 therefore stands as
   written: a new packaging line is checked against the outlet's current price
   like a menu line. Per bag, the count still goes up and down, never below one.
9. **A chosen chip is taken back by tapping it again**, leaving the order
   unanswered, with Order and Paid held again.
10. **With tables, the dine-in chip reads *Table N* or *No table*** once
    answered, not *Dine-in · Table N*.
11. **The table pad arranges itself** by count: 8 as 4 × 2, 9 as 3 × 3, and the
    least ragged, most nearly square block otherwise.
12. **Two open orders at one table are still allowed, and now each says which it
    is**: *Table 8 · 1 of 2* on the older card, *2 of 2* on the newer (D5). The
    owner found the third way in — a payment taken back after the table was
    seated again — and chose showing over refusing.
13. **A save says so.** Save becomes a spinner, then a filled *✓ Saved* with
    the tick drawing in, the card's edge glows once in the primary orange. *✓ Saved* is drawn like a
    secondary button, in accent-orange text on the card, rather than filled
    [owner, 2026-09-27]: a filled pill read as a button to press again, and
    green read as out of theme, and after a moment
    the bar folds away; *Orders saved* is announced. Nothing moves under
    reduced motion. Touching a setting meanwhile brings Save straight back.
14. **Two production counts are wanted** — shared tables and dine-in without a
    table. The second is a query today; the first gets `orders.table_shared`
    (D11, task 4.2a), since it cannot be read back from history.
15. **A manager changes these settings for the outlets they manage**, reversing
    decision 4 of 2026-09-26. They get the owner's editable section; a manager of
    another outlet still cannot open the page. It is these six settings only:
    Details — name, address, day cutover, check-in fence, closing — stays the
    owner's, because the fence judges staff attendance and the cutover decides
    every bill's business day, and opening those is its own change if wanted.
    In the database, a narrow function rather than a wider `outlets_update` (RLS
    above).

## Checkpoint settled (2026-09-27)

**The owner approved the settings page and the counter as they stand** after
round 1 above ("lgtm", 2026-09-27). This is task 2.3's gate: sections 3 onward
may begin. Round 1's fifteen items are the difference between the sketches and
what was settled, and the spec deltas `service-and-packaging`, `order-lifecycle`
and `outlet-tenancy` carry every one that changed a requirement.

Still open, and not part of this gate: whether a manager may also change the
outlet's Details (name, address, day cutover, check-in fence, closing). That is
its own change if wanted; the fence would stay the owner's either way.

## Owner checkpoint, round 2 (2026-09-27, after the checkpoint)

The owner reopened the table choice after settling the rest.

1. **No table count.** *Table numbers* is a switch and nothing more; the column
   is `table_numbers boolean`, not `table_count` (D1). Tables are whatever the
   biller keys, 1 to 999.
2. **The popup is a number pad**, like the customer keypad: one to three digits,
   no `.` or `00`, *No table* and *Done*. The grid of numbered buttons, and its
   self-arranging layout (round 1, item 11), are gone.
3. **A table already open is refused in red** (D5), the way an invalid mobile
   number is. It no longer opens that order to add to it; more food for a table
   goes on its order from the rail. The gate line changes to match.
4. **The refusal is one line** [owner, 2026-09-27]: *Table 4 is already open.*
   in red, then **Edit here.** as a link; or *Table 4 is open on Counter 2.* where
   another tablet holds it, and just *Table 4 is already open.* while another
   order is being edited, since nothing can be done from there.
5. ***Edit here.* is a link** (pointer cursor) that opens that order for editing, **exactly as its
   card's Edit does**: the pad closes, the bill in progress is set aside and
   comes back when the edit ends, and nothing is carried across. It is offered
   only when this tablet owns the order and no other order is being edited;
   otherwise the line says what to do without offering to do it.
