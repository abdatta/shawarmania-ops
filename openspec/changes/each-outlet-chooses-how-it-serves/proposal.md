# Proposal: each-outlet-chooses-how-it-serves

> **Model**: Opus · **Wave**: F · **Depends on**: #57, #55, #53, and the unlisted `outlets-one-at-a-time` · **Gate**: each outlet chooses, on its own settings page, whether its orders are marked dine-in or takeaway, whether dine-in orders take a table number, and whether a packaging charge is added per bag or per order, with packaging optionally free for gold members. A new outlet starts with every switch off and bills exactly as today. With the switches on, a biller marks an order in one tap, a dine-in order is called by its table instead of its order number, a busy table opens the order already on it, and a takeaway order carries its packaging as a line on the bill that the biller can change or remove. Every one of those orders rung offline settles exactly once. The owner settled the settings page and the counter in the demo before any of it reached production, and the four-role demo walkthrough still walks.

## Why

The owner asked for it on 2026-09-26, ahead of the move to one new outlet,
*Kalyani Cafe*, from about October 2026.

Three things the counter cannot say today:

1. **Where the food goes.** Every order looks the same. The kitchen cannot tell
   a plate for table 4 from a parcel at the counter.
2. **Which table.** A dine-in customer is called by an order number. At a shop
   with tables, the table *is* the name: one table has at most one open order at
   a time, and more food for that table is more lines on the same order.
3. **What the packaging cost.** Parcels use bags and boxes that cost money, and
   nothing on the bill recovers it.

**Every one of these is a choice a shop makes, not a fact about Shawarmania.**
The owner was explicit that a new outlet (or a franchise) may want none of it and
bill exactly as today. It may have no seating, so dine-in means nothing there
while packaging still applies. It may charge per bag, or a flat amount. It may
waive packaging for gold members, or not. So every rule here is **per outlet**,
off by default, and set on that outlet's page. It does not ship as a behaviour
of the app.

**The settings page must stay simple for a newcomer.** An outlet setting itself
up sees two switches. A switch opens its own settings underneath only when it is
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

Two new sections on the page `outlets-one-at-a-time` builds, each one switch
until it is turned on. Sketch (the owner saw a live version of this on
2026-09-26):

```
ORDERS
  Dine-in and takeaway                          [ off ]
      └ when on:
        Offer            ( Dine-in ) ( Takeaway )     ← at least one
        Can skip         [ on ]      order may be neither
        Table numbers    [ off ]     only while Dine-in is offered
            └ when on:   How many tables   [ 8 ]

PACKAGING
  Packaging charge                              [ off ]
      └ when on:
        Charge by        ( Per bag ) ( Flat per order )
        Price per bag    ₹ [ 5 ]        (or "Charge per order ₹ [10]")
        Free for gold members ⭐        [ off ]
```

Defaults when a switch is first turned on: both order types offered, *Can skip*
on, no tables, packaging per bag at a price the owner types. The owner sets
these. A manager sees them read-only, for the outlets they manage and no others
(owner, 2026-09-26; see Non-goals).

### At the counter

- **Marking an order.** When the outlet offers them, *Dine-in* and *Takeaway*
  sit as two chips beside the customer control. One tap marks the order. When
  *Can skip* is on, no chip needs to be chosen, and tapping the chosen one again
  clears it. When it is off, the order starts on the first offered type.
- **Tables.** Choosing *Dine-in* at an outlet with tables asks which table, in
  a popup of numbered buttons 1 to N. A table with an open order is drawn busy.
  Tapping a busy table opens **that order** to add to it, instead of starting a
  second. The order is then called *Table 4* everywhere the counter used to show
  *#105*: the composer while editing, the pipeline card and the shift's bill
  list. The order number is still allocated and still stored. It is simply not
  what anybody calls this order by.
- **Packaging.** An outlet charging for packaging adds it automatically, **as a
  line on the bill**, to every order that is not dine-in. Per bag, the line reads
  *Packaging × 1* with the same − / + controls every line has, starting at one.
  Flat, it reads *Packaging* at the outlet's amount. Either can be removed like any
  line, for the customer who brings their own bag. Switching an order to dine-in
  removes the line. Switching it to takeaway adds it.
- **Gold.** At an outlet waiving packaging for gold members, identifying a gold
  member makes the packaging line free, shown struck through as ₹5 → Free.
  Identifying someone else, or clearing the customer, charges it again. Once the
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

- **A manager cannot change these settings.** The owner alone writes an outlet
  row today (`outlets_update`). Opening these columns to a Franchise Admin is a
  new write path on that row, and it waits until a franchise actually asks. A
  manager sees the settings read-only.
- **No floor plan, table layout, table names or merging tables.** Tables are
  numbers 1 to N.
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
- `docs/SCREENS.md`: the Outlets page's two new sections, and the counter's
  chips, table popup and packaging line.
- `docs/DATA_MODEL.md`: the outlet's service settings, the order's and bill's
  service facts, and the packaging line kind.
- `docs/GLOSSARY.md`: *dine-in*, *takeaway*, *table*, *packaging charge*,
  *packaging waiver*.
- `docs/OFFLINE_AND_SYNC.md`: settings in the resume record, and why a table is
  not made unique by the database.
- `docs/LIMITATIONS.md`: the gold waiver as #57's one exception; two tablets
  seating one table offline; packaging-price changes racing an offline tablet.
- `docs/OPERATIONS.md`: onboarding a new outlet leaves these off, and where to
  turn them on.
- `docs/DEMO_MODE.md`: the walkthrough's dine-in, table and packaging steps.
