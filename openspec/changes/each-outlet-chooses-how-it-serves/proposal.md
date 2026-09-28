# Proposal: each-outlet-chooses-how-it-serves

> **Model**: Opus · **Wave**: F · **Depends on**: #57, #55, #53, and the unlisted `outlets-one-at-a-time` · **Gate**: each outlet chooses, on its own settings page, whether its orders are marked dine-in or takeaway, whether dine-in orders take a keyed table number, and whether a packaging charge is added per bag or per order, with packaging optionally free for gold members. A new outlet starts with every switch off and bills exactly as today. With the switches on, the counter asks where the food goes only where there is a choice, and a biller answers it in one tap before the order is saved or paid, a dine-in order is called by its table instead of its order number, a table already open is refused, and a takeaway order carries its packaging as a line on the bill that the biller cannot remove or reprice. Every one of those orders rung offline settles exactly once. The owner settled the settings page and the counter in the demo before any of it reached production, and the four-role demo walkthrough still walks.

## Why

The owner asked for it on 2026-09-26, ahead of the move to one new outlet,
*Kalyani Cafe*, from about October 2026.

Three things the counter cannot say today:

1. **Where the food goes.** Every order looks the same. The kitchen cannot tell
   a plate for table 4 from a parcel at the counter.
2. **Which table.** A dine-in customer is called by an order number. At a shop
   with tables, the table *is* the name: the counter seats one open order at a
   table, and more food for that table is more lines on the same order.
3. **What the packaging cost.** Parcels use bags and boxes that cost money, and
   nothing on the bill recovers it.

**Every one of these is a choice a shop makes, not a fact about Shawarmania.**
The owner was explicit that a new outlet (or a franchise) may want none of it and
bill exactly as today. It may have no seating, so it offers takeaway alone and
charges for packaging on every order. It may charge per bag, or a flat amount. It may
waive packaging for gold members, or not. So every rule here is **per outlet**,
off by default, and set on that outlet's page. It does not ship as a behaviour
of the app.

**The settings page must stay simple for a newcomer.** An outlet setting itself
up sees one switch. A switch opens its own settings inside itself only when it is
turned on, and folds them away when it is turned off. The page grows as the shop
does.

## Owner decisions, 2026-09-26

- **Packaging free for gold members is accepted as a deliberate widening of #57.**
  `a-gold-member-is-a-label` states that membership confers *no automatic price
  change*. This change is the first exception, and it is exactly one: an
  outlet may choose that a gold member's packaging costs nothing. Everything else
  #57 said stands. See *What this does to gold* below.
- **Zomato and Swiggy orders never carry our packaging charge.** The platforms
  charge their own. Those orders are not rung at the counter, so nothing here
  can reach them. This is stated so nobody adds it by reflex.
- **A takeaway order starts with one bag.** The biller changes it from there.
- **A table frees when its order is paid** (or cancelled). Nothing else frees it.

## What changes

### The outlet's settings page

One new section, **Orders**, on the page `outlets-one-at-a-time` builds: one
switch until it is turned on. Each setting's own options open **inside** its
tile. As settled at the checkpoint (owner, 2026-09-27; `design.md` records what
changed from the first sketch):

```
ORDERS
┌ Dine-in and takeaway                              [ off ] ┐
│ ┌ Offer            ( Dine-in ) ( Takeaway )  at least one ┐│
│ ┌ Table numbers    [ off ]     only while Dine-in is offered││
│ ┌ Packaging charge [ off ]     only while Takeaway is offered│
│ │ ┌ Charge by   ( Flat per order ) ( Per bag )           ┐ │
│ │ ┌ Charge per order  ₹ [ 10 ]   (or "Price per bag")    ┐ │
│ │ ┌ Free for gold members ⭐  [ off ]                     ┐ │
└──────────────────────────────────────────────────────────┘
```

Defaults when a switch is first turned on: both order types offered, no tables,
packaging flat per order at a price the owner types. The owner sets these
for any outlet, and a manager for the outlets they manage (owner, 2026-09-27;
see Non-goals).

### At the counter

- **Marking an order.** Where there is a choice — both types offered, or dine-in
  with tables — the offered types sit as chips on a row above the customer
  control.
  Nothing is preselected, one tap marks the order, and the order cannot be saved
  or paid until it is marked, as it cannot until the customer is decided. An
  outlet offering one type with nothing to choose shows no chip: every order
  there is that type.
- **Tables.** Choosing *Dine-in* at an outlet with table numbers asks which
  table, on a number pad: the biller keys it, 1 to 999, and the outlet keeps no
  count of its tables. A table that already has an open order is refused in
  red, as an invalid mobile number is (owner, 2026-09-27). The order is then called *Table 4* everywhere the counter used to show
  *#105*: the composer while editing, the pipeline card and the shift's bill
  list. The order number is still allocated and still stored. It is simply not
  what anybody calls this order by.
- **Packaging.** An outlet charging for packaging adds it automatically, **as a
  line on the bill**, to every takeaway order, and to no other. Per bag, the line reads
  *Packaging × 1* with the same − / + controls every line has, starting at one.
  Flat, it reads *Packaging* at the outlet's amount. The biller cannot remove
  it or change its price (owner, 2026-09-27); per bag, the count goes down to one
  and no further. Switching an order to dine-in removes the line. Switching it to
  takeaway adds it.
- **Gold.** At an outlet waiving packaging for gold members, identifying a gold
  member makes the packaging line free, shown struck through as ₹5 → Free.
  Identifying someone else, or skipping the customer, charges it again. Once the
  order is paid, it is fixed.

### What this does to gold

#57 made gold a label and recorded why: nothing automatic, so every benefit is a
biller's decision and the cost of gold stays a question nobody has to answer
yet. It also recorded that a gold discount given by hand is indistinguishable
from any other, so *"what did gold cost us"* is unanswerable, and that bills are
append-only, so that attribution cannot be added later.

This change keeps the one automatic benefit **attributable from its first
day**. The waiver is recorded as the packaging line's own discount (see
`design.md`), so *"how much packaging did gold members get free"* is a sum over
stored rows. It is never inferred.

## Non-goals

- **A manager changes nothing else on the outlet.** A manager changes these
  settings for the outlets they manage (owner, 2026-09-27), through a narrow
  write that reaches these settings alone. The rest of the outlet row — name,
  address, day cutover, check-in fence, closing — stays the owner's.
- **No floor plan, table layout, table names or merging tables.** Tables are
  numbers, keyed, 1 to 999.
- **No different menu prices for dine-in and takeaway.**
- **No more than one packaging product.** There is one bag price or one flat
  amount, with no small-bag and large-box.
- **No packaging on dine-in**, and none on aggregator orders (see decisions).
- **No per-type reporting in the Ledger.** The facts are stored on every order
  and bill (type, table, and packaging as a line of its own kind), so a later
  report can read them. None is built here.
- **The public receipt shows the packaging line and its waiver as the stored
  line and discount they are, through the renderer it already has.** Naming the
  waiver *Gold member · packaging free*, and printing *Dine-in · Table 4* on the
  receipt, are renderer changes in the landing repository and belong with #58
  `the-receipt-names-its-customer`. They are noted there.
- **No change to how gold is granted, revoked, shown or snapshotted.**

## Docs to update before archiving

- `docs/BUSINESS_CONTEXT.md`: how the counter serves (dine-in, takeaway, tables,
  packaging) as per-outlet choices.
- `docs/SCREENS.md`: the outlet page's Orders section, and the counter's chips,
  table pad (with its refusal and *Edit here*), packaging line and *1 of 2*
  marker.
- `docs/DATA_MODEL.md`: the outlet's six service settings, the order's and
  bill's service facts, the packaging line kind, and `orders.table_shared`.
- `docs/ROLES_AND_PERMISSIONS.md`: a manager changes their outlets' service
  settings through `set_outlet_service_settings`, and nothing else of the
  outlet row.
- `docs/GLOSSARY.md`: *dine-in*, *takeaway*, *table*, *packaging charge*,
  *packaging waiver*.
- `docs/OFFLINE_AND_SYNC.md`: settings in the resume record, and why a table is
  not made unique by the database.
- `docs/LIMITATIONS.md`: the gold waiver as #57's one exception; two tablets
  seating one table offline; packaging-price changes racing an offline tablet.
- `docs/OPERATIONS.md`: onboarding a new outlet leaves these off, and where to
  turn them on; the two D11 queries (shared tables, dine-in without a table).
- `docs/DEMO_MODE.md`: the walkthrough's dine-in, table and packaging steps.
