# Design: each-outlet-chooses-how-it-serves

This design states the change **as settled**: the owner walked the demo on
2026-09-27 and changed it in two rounds, and every D-section below is written
to the result. What changed from the first sketches, and when, is in
[Decisions](#decisions) at the end.

## Context

What this change stands on, checked against the code on 2026-09-26 and
re-checked while building section 3 on 2026-09-27:

- **An outlet row is written by the owner alone.** `outlets_update` refuses
  everybody else, and the isolation suite proves it by hand-crafted request.
- **An outlet row is read by the owner, by everybody with a live assignment at
  that outlet, and by a counter device for its own outlet** — `outlets_select`
  since `20260810000001_counter_tablet_and_shift.sql`. A tablet reads its own
  outlet from the moment it is set up.
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

## D1. The settings are six columns on `outlets`

```
dine_in_offered          boolean  not null default false
takeaway_offered         boolean  not null default false
table_numbers            boolean  not null default false
packaging_mode           enum packaging_mode ('off','per_bag','per_order') not null default 'off'
packaging_price_paise    integer  null
packaging_free_for_gold  boolean  not null default false
```

Checks, each stated on the table so a hand-crafted request meets it:

- `table_numbers` only with `dine_in_offered`. There is **no count of tables**:
  the biller keys the number, 1 to 999 (D9).
- `packaging_mode` is `'off'` unless `takeaway_offered`: packaging is charged on
  takeaway orders and nowhere else.
- `packaging_price_paise` is null exactly when `packaging_mode = 'off'`.
  Otherwise it is a whole number of rupees (a multiple of 100) of **at least ₹1,
  with no upper limit**. Whole rupees, because every bill already ends on a whole
  rupee and a 50-paise bag would only feed the rounding line.
- `packaging_free_for_gold` only with a packaging charge.

The **Orders** switch on the page is derived, not stored: it reads *on* while
either type is offered. Turning it on offers both types; turning it off clears
both, table numbers and the packaging charge. Ceasing to offer takeaway clears
the packaging charge. One stored truth, and no switch that can disagree with
what sits under it.

**Every existing outlet takes the defaults, which are all off**, and the
migration asserts it. Production bills exactly as it did the moment before.

There is no *Can skip* column. *Neither* is still a value an order records — at
an outlet offering no type, for everything rung before these choices, and for
an order an offline tablet rang before the owner turned types on — but where the
counter asks, it must be answered (D9).

## D2. Orders and bills carry how they were served

```
orders.service_type   enum service_type ('dine_in','takeaway') null   -- null = neither
orders.table_number   smallint null check (between 1 and 999)
bills.service_type    same, copied from the order, or from a direct sale's own payload
bills.table_number    same
```

`table_number` only with `service_type = 'dine_in'`. Both are **snapshots**,
like the tier and the lines: they record what was chosen when the order was
rung, and no later settings change rewrites them. Both may change on a revision
while the order is open, and both are fixed at payment, like everything else on
the order.

The daily order number is **still allocated for every order**, table or not. A
table is what the counter *calls* the order, not its identity: history, voids
and every manager surface go on working by order and bill number.

## D3. Packaging is a line, of its own kind

```
order_items.kind  enum line_kind ('item','packaging') not null default 'item'
bill_items.kind   same
```

A packaging line has `kind = 'packaging'`, no `menu_item_id`, no category, the
name *Packaging* in both modes, `unit_price_paise` = the outlet's price, and
`quantity` = bags (per bag) or 1 (flat). At most one packaging line per order,
enforced by a partial unique index on `(order_id) where kind = 'packaging'` and
its bill twin.

**Why a line.** A line is already snapshotted, already in the subtotal, already
reconciled by every guard and already on the receipt. The totals identity
`total = subtotal − discount + tax + rounding` does not move, so `lint:totals`
holds without a new case. Packaging reaches the Ledger through bill totals like
any other sale, and `kind` lets a later report separate it.

**The counter neither removes nor reprices it.** It is added when an order is
marked takeaway and taken off when it stops being takeaway, and nothing else
touches it but the bag count, which goes down to one and no further (D9).

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
  it. The waiver is *about* the customer, who is routinely identified after the
  first bag is on the bill, so it is re-derived on every revision from the
  order's current customer and the outlet's setting at that moment. Skipping
  the customer charges it again. Once the order is paid it is fixed.
- **The tablet decides, and the server does not second-guess it.** #57's
  server-side tier snapshot answers *was this customer gold at the moment of
  sale*. The tablet answers from what it was told. The two can disagree only
  when a grant or revocation races a sale, and refusing a paid sale over a
  ₹5 bag would strand the money. The bill keeps both facts, and a reader who
  cares can compare them.

## D5. A table is unique at the counter, never at the database

A table is **busy** while any **open** order at this outlet, in the pipeline the
tablet can see (live or remembered), carries it. **Keying a busy table is
refused, in red**, the way an invalid mobile number is:

- *Table 4 is already open.* **Edit here.** — where this tablet owns that order
  and no other order is being edited. *Edit here* opens it exactly as its card's
  Edit does: the pad closes, the bill in progress is set aside and comes back
  when the edit ends, and nothing is carried across.
- *Table 4 is already open.* — while another order is being edited, since
  nothing can be done from inside that edit.
- *Table 4 is open on Counter 2.* — where another tablet holds it.

An order being edited is never refused its own table.

**The database does not refuse a second open order on the same table.** It can
happen three ways: two tablets that could not see each other, one tablet working
from a stale remembered pipeline, and a payment taken back after the table was
seated again. By the time the second command reaches the server the food may
have been served and paid for, and a unique index would refuse a real sale to
protect a label. Instead each card reads *Table 4* with its place among the open
orders there — **1 of 2** for the older, **2 of 2** for the newer, in the warning
fill — and the biller sorts it out in the room, the only place it can be sorted
out. The server also records it (D11).

A table frees when its order is **paid or cancelled**, because that is when the
order stops being open. A paid order still owed food keeps reading *Table 4* on
its card, so the kitchen knows where to take it; "free" only means a new order
may take the number. Turning table numbers off strands nothing: an open order
keeps its table, and new orders are simply not asked for one.

## D6. How the settings reach the counter

- **The counter reads them from its own outlet row**, which `outlets_select`
  already lets a device read (Context). No read function, and no wider grant,
  is needed; section 3 proved it by a device of the other outlet reading
  nothing.
- They travel **with the menu**, on the same refresh path (`OutletMenu.service`),
  so a running tablet picks up a change at its next menu refresh.
- The resume record (#34) persists `OutletMenu` whole, so a cold-started offline
  tablet serves the way its outlet does with no new storage.
- Lines already captured keep their price. A packaging price change reaches new
  orders, and reaches a revision only through a packaging line that the revision
  adds. It never reprices an existing one. **In the live counter every save
  re-sends every line as new** (D8, section 4 finding), so a revision of an order
  still holding the old price is refused rather than repriced.

## D7. The payload, version 3

The order and payment content payloads gain `serviceType`, `tableNumber` and, per
line, `kind`. `BILLING_COMMAND_SCHEMA_VERSION` becomes 3. **The boundary accepts
versions 1, 2 and 3**, reading the earlier shapes as *neither, no table, every
line an item*, exactly as #53 read the pre-discount shape. A till holding queued
work across this release settles it exactly once. The canonical JSON and hash
are proved across runtimes by new shared vectors for v3, and the existing
vectors keep passing.

## D8. What the boundary validates

**Service facts are checked for shape, never against the current settings.**
`service_type` is one of the enum or null, `table_number` is 1 to 999 and only
with dine-in. Whether the outlet *currently offers* dine-in is **not checked**:
an offline tablet may have captured the order before the owner changed the
setting, and settings are how the counter behaves, not a money rule.

**A packaging line is checked the way a menu line is checked, and for the same
reason.** A new `kind = 'packaging'` line must carry the outlet's current
`packaging_price_paise` and the name *Packaging*, with no `menu_item_id` and no
category. An existing one is compared by identity, as `order_items` already
are. So a packaging price change **races an offline tablet exactly as a menu
price change already does**, with whatever that path does about it.

*Read in section 4:* a new line that does not match the current menu is refused
as `arithmetic_invalid`, a terminal refusal. The live counter gives every line a
fresh identity on every save, so the identity branch never runs for it: after a
price change, an edit of an open order holding the old price is refused, and so
is work queued offline at it, a direct sale included; paying a saved order is
unaffected. Packaging follows the same rule, and `docs/LIMITATIONS.md` records
both. Keeping line identities across saves is the fix for both, and is not this
change's.

**A packaging line's discount is the whole line or nothing.** Any other value,
and any discount on an item line that claims `discount_percent_bp = 10000`
without a category, is refused as malformed. **At most one packaging line.**

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
│          Table 12            │  ← red if 12 is open, with one line (D5)
│      ( 1 ) ( 2 ) ( 3 )       │
│      ( 4 ) ( 5 ) ( 6 )       │
│      ( 7 ) ( 8 ) ( 9 )       │
│            ( 0 ) ( ⌫ )       │  ← no `.`, no `00`; three digits at most
│ [ No table ]     [ Done ]    │
└──────────────────────────────┘

Pipeline card:  Table 4  [1 of 2]  ·  2 items  · [Prepared] [Paid]
                (replaces #105; the number is not shown beside it)
```

- **The counter asks only where there is a choice**: both types offered, or
  dine-in with table numbers. At a takeaway-only outlet no chip is shown and
  every order is takeaway, with its packaging; at a dine-in-only outlet without
  table numbers, every order is dine-in with no table.
- **Where it asks, nothing is preselected and the answer is owed**: Order and
  Paid wait for it, exactly as they wait for the customer decision. Tapping the
  chosen chip again takes a mistaken tap back, and the answer is owed again.
- **The chips sit on a row of their own above the customer control**, sharing
  the panel's width.
- **The table is keyed on a number pad**, opened the way the customer keypad
  opens so the composer stays its height: 1 to 999, no leading nought, no
  decimal point and no `00`, with *No table* and *Done*. Tapping the dine-in chip
  again reopens it to change the table.
- **With table numbers, the dine-in chip reads the answer alone**: *Table 4*, or
  *No table*. A dine-in order with no table is called by its number, as today.
- **Where an order has a table, *Table 4* replaces the order number** on the
  composer's editing header, the pipeline card and Bills this shift; the number
  is not shown beside it. Where it has no table, the card's metadata line says
  *Takeaway* or *Dine-in*, so the kitchen can tell a plate from a parcel.
- **Packaging is last among the lines**, so the food reads first. Per bag it
  counts down to one; flat it carries no control. The kitchen ticket lists it
  (*1× Packaging*) so whoever packs sees the bags.
- **The waiver reads *₹5* struck through over *Free***, with no *Menu discount*
  row for it, on the composer, Bills this shift and the manager's bill detail.
  The manager's detail adds *Served: Dine-in · Table 4* beside the order and
  bill numbers.

## D10. The settings page

- **One section, Orders**, between Details and Tablets on a trading outlet's
  page. A new outlet sees one switch.
- **Each setting's options open inside its own tile**, each level on the other of
  the two surface tones from the one it sits in, so what belongs to what reads
  from the shape: *Offer* (at least one type stays offered), *Table numbers*
  while dine-in is offered, *Packaging charge* while takeaway is offered, and
  inside it *Charge by* (**flat per order first, and the default**), the price
  in whole rupees, and *Free for gold members*.
- **The section saves as one**, with a Save that appears only once something
  changed; a switch shapes a draft rather than writing, because turning
  packaging on needs a price the owner types. Cancel puts back what is stored.
  **A save says so**: Save becomes a spinner, then a quiet secondary-styled
  *✓ Saved* in the accent orange with the tick drawing in, the card's edge glows
  once, and the bar folds away; *Orders saved* is announced. Nothing moves
  under reduced motion.
- **The owner edits it for any outlet, and a manager for the outlets they
  manage.** Details stays the owner's (RLS).

## D11. What production can count

The owner wants two numbers once this ships: how often two open orders shared a
table, and how many dine-in orders had no table.

- **Dine-in with no table** needs nothing added: `service_type = 'dine_in' and
  table_number is null`, over `orders` or `bills`, per outlet and business date.
  An order does not record whether its outlet had table numbers on at the time,
  so *No table* chosen and *no table numbers* read alike; read against the
  outlet's settings, which change rarely.
- **A shared table cannot be read back reliably.** An order stores its last
  table, not its history, and a payment taken back rewrites its paid time, so
  reconstructing overlaps from open intervals misses a table changed mid-order
  and misses the case the owner found. So the boundary records it as it
  happens: **`orders.table_shared boolean not null default false`**, set on every
  order involved whenever a create, a revision or a payment taken back leaves two
  or more open orders at one outlet on one table, in the same transaction. It is
  never unset, so it survives payment. Orders that shared: `count(*) where
  table_shared`; incidents: the same grouped by outlet, business date and table.
  It is telemetry about the order, never a refusal of it (D5), and one column on
  a table already scoped by outlet.

## Demo first, and the live counter unchanged until section 5

Section 1 built all of this against the mock adapter, behind a **part gate**
`outlet-service-choices` in `src/gates/registry.ts` (the registry gated only
whole surfaces by route, and this sits inside a live one). Section 5 promotes it
with a one-line edit. Until then the **live** outlets adapter reads all-off and
refuses the write, and the live menu read carries no `service` (absent reads as
all-off), so production renders exactly what it renders today.

The demo's **Kalyani has chosen nothing and Kanchrapara everything**. Kalyani is
where the demo counter stands, so every walkthrough and every existing counter
test starts on today's counter — which is itself the claim that an all-off
outlet is unchanged — and the walkthrough's first step turns Kalyani's switches
on. The mock checks the payload shapes D8 describes and refuses as `malformed`,
so the demo cannot accept what the boundary will not.

## Money arithmetic

- Packaging price: integer paise, a whole number of rupees, at least ₹1, stored
  on the outlet and snapshotted on the line. Per bag: `unit × bags`. Flat:
  `unit × 1`. Existing line arithmetic constraints apply unchanged.
- Waiver: `discount_paise = line_total_paise`, bounded by the existing
  `discount_paise <= line_total_paise` check. It counts in the parent's discount
  exactly as a menu line discount does, and is inside the existing cap at the
  subtotal.
- No new term in the totals identity; `lint:totals` needs no new case.
  `lint:discount-rows` gains a waiver case (a full-line discount on a packaging
  line, alongside a bill discount) so its arithmetic is pinned in both runtimes.

## RLS

- **No new table.** The new columns sit on `outlets`, `orders`, `order_items`,
  `bills` and `bill_items`, whose policies already scope them. They are covered
  by the isolation suite by *extension*, not by assumption.
- **The owner and the outlet's own managers write the settings** through one
  narrow security-definer function, `set_outlet_service_settings(outlet, …six
  values)`, which re-derives the caller's authority (`app_is_owner()` or
  `app_has_role_at('franchise_admin', outlet)`, with a live account) and writes
  these six columns and nothing else. `outlets_update` is **not widened**: it
  stays the owner's alone for every other column, so a manager never reaches the
  cutover, the check-in fence or closing through this door, and a manager's
  direct update of the row still touches nothing.
- **Reads follow the row**: whoever may read the outlet row reads its settings —
  the owner, anybody live at that outlet, and a counter device for its own
  outlet only (D6). A device or person of the other outlet reads nothing.

## Offline

- Settings travel in the resume record (D6).
- Service facts and packaging lines ride the existing command queue in the v3
  payload (D7). An order rung offline for table 4 with two bags and a gold waiver
  settles exactly once on reconnect.
- The busy-table view offline is the remembered pipeline, so it can be stale.
  D5 is what makes that safe, and D11 counts it.
- **A dine-in order with a table needs no order number to be called**, so the
  unsent-number shape (`the-order-number-arrives-when-it-arrives`) stops
  mattering for exactly the orders that have a table.

## Rejected alternatives

- **Packaging as a menu item the biller taps.** Not automatic, not waivable for
  gold without a rule reaching into the menu, and it would count bags as food in
  any menu report. A bag is still a line with a quantity.
- **Packaging as a bill-level charge column, beside rounding.** It adds a term to
  the totals identity in three places plus both lint tables, for a fact a line
  already carries.
- **Packaging as its own section, charged on every order that is not dine-in.**
  The first draft, meant for a parcel-only shop showing no chips. That shop
  offers takeaway alone, and every order it rings is takeaway without a chip.
- **Gold: leave the packaging line off entirely.** Simpler, and it throws away
  the one number #57 said could never be recovered later: what gold cost.
- **Gold: a new `membership` discount source.** The hedge #57 cut: a new enum, a
  payload field, both runtimes' discount-row cases and a receipt renderer change,
  to say what `kind = 'packaging'` already says.
- **Starting an order on the first offered type, with a *Can skip* setting.** A
  preselected type is recorded whether or not anybody meant it; the answer is
  owed instead, and a one-type outlet is not asked at all.
- **A count of tables and a grid of numbered buttons.** A count has to be kept
  up to date as the floor changes, and a grid is hunted along. A keyed number
  needs neither.
- **Opening a busy table's order from the pad, carrying the new items into it.**
  Built once and replaced: the refusal is plainer, and *Edit here* behaves
  exactly as the card's own Edit, so nothing moves without the biller seeing it.
- **A unique open-order index on `(outlet, table)`.** It refuses real sales to
  protect a label (D5).
- **Widening `outlets_update` to managers.** It would hand them the cutover and
  the check-in fence; a narrow function reaches the six settings alone.
- **Settings in their own 1:1 table.** Another policy and another isolation case
  to hold six columns, on a row that is already scoped and already read by
  everyone who needs them.
- **Checking service facts against the current settings at the boundary.** It
  refuses offline work over a UX preference (D8).
- **Letting the biller remove or reprice packaging.** Asked for and withdrawn the
  same day; D8 checks a new packaging line against the outlet's price.
- **A ₹500 ceiling on the packaging price.** A typo guard with no unit to guard.
- **_Bag_ as the per-bag line's name.** *Packaging* in both modes reads the same
  whichever mode an outlet uses.

## Decisions

**2026-09-26, before and after the proposal** — gold waiver yes; aggregator
orders never carry our packaging; one bag to start; a table frees on payment or
cancellation; the line is *Packaging* in both modes; tables open in a popup
rather than inline; *Table 4* replaces the order number rather than sitting
beside it. A manager was to see the settings read-only — reversed below.

**2026-09-27, the checkpoint (round 1)** — the owner walked the demo and
changed it:

1. Packaging lives inside Takeaway and is charged on takeaway orders only; the
   page is one Orders section with one Save.
2. Options nest inside their own tile, on alternating surface tones.
3. Flat per order is the first packaging option and the default.
4. The counter asks only where there is a choice, and the answer is owed.
5. There is no *Can skip*.
6. No upper limit on the packaging price.
7. The chips sit above the customer control.
8. The biller neither removes nor reprices packaging (asked for, then withdrawn).
9. A chosen chip is taken back by tapping it again.
10. With table numbers, the dine-in chip reads *Table N* or *No table*.
11. Two open orders at one table each say which they are, 1 of 2 / 2 of 2.
12. A save says so; its *✓ Saved* is quiet and in the accent orange, not green
    and not filled.
13. Two production counts are wanted (D11).
14. A manager changes these settings for the outlets they manage; Details stays
    the owner's.

The owner then approved the settings page and the counter ("lgtm") — task 2.3's
gate. Still open and not part of this change: whether a manager may change the
outlet's Details; the check-in fence would stay the owner's either way.

**2026-09-27, round 2, after the checkpoint** — the table choice:

1. No count of tables; *Table numbers* is a switch.
2. The table is keyed on a number pad, 1 to 999. The self-arranging grid built
   in round 1 is gone with it.
3. A table already open is refused in red, in one line, with **Edit here** to
   its order, which behaves exactly as the card's Edit (D5).

The spec deltas carry every decision that changed a requirement.

**2026-09-28, section 4, what building it found** — three defects already in
production, each fixed here because this change rebuilds the code they sit in,
and each pinned by a test that fails without its fix:

1. *An edit that moves an order's rounding was refused.* The order guard's list
   of what a revision may change predated `rounding_paise` (#53), so adding an
   item to an order with a percentage off the bill raised, and the till read it
   as a malformed edit. The list gains it with the type, the table and the
   shared mark.
2. *An order saved with a bill discount could not be edited at all.* The guard
   on `order_discounts` returned `new` on DELETE, which is null, and a BEFORE
   trigger returning null cancels the delete silently; a revision's old discount
   records survived beside the new ones and the parts-equal-the-whole check
   refused it at commit. It returns `coalesce(new, old)`, as the other guards do.
   `bill_discounts` keeps its own `reject_mutation`, so bills stay immutable.
3. *The live counter saved orders without their bill discount.* Both callers of
   the adapter's `orderPayload` left out its trailing discounts argument, so a
   saved order reached the server at full price while the tablet showed it
   discounted. The builder now takes the input whole, and v3's service facts go
   through the same door.

And three choices the design left open:

4. `table_shared` is set by a trigger on `orders`, not in each money function,
   as #57's tier snapshot is. It locks per outlet and table before counting and
   marks the other orders with SKIP LOCKED, so it can neither miss a concurrent
   seating nor deadlock two sales; the one case it leaves unmarked is an order
   paid or cancelled in the same instant, which had left the table anyway.
5. The receipt's discount rows give the gold waiver its own row,
   `source = 'packaging'`, between the menu rows and the bill's, so the printed
   rows still add up to the stored discount; `groupMenuDiscounts` and
   `bill_public_discount_rows` both leave it out of the menu rows, held together
   by a new shared case. #58 words it.
6. A version-1 or version-2 revision leaves an order's type and table as they
   are rather than clearing them: it was written by a till that knew nothing of
   them.

**2026-09-28, section 5, going live** — the screen did not change, as the mock
promised. One more defect surfaced and went: a restarted tablet redrew an
offline-revised order from its queue without the revision's line and bill
discounts (its total was right, its lines and discount rows were not). Every
local view drawn from a queued command now goes through one helper, which is
also how the type, the table and each line's kind reach an offline pipeline.
The receipt page in the landing repository types a discount row's `source` and
checks it nowhere, so until #58 it prints the waiver as *Discount (100%) ·
Selected items*: the right amount, the wrong words; recorded in LIMITATIONS and
in #58's proposal.
