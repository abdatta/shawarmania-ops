# Proposal: Each Dish Is Ticked Off

> **Model**: Opus · **Wave**: F · **Depends on**: **#72**, #70, #69 · **Gate**: the
> owner approved the counter's new layout, the label, the dish ticks, the notes and
> the Ready checkbox cue from demo screenshots before any of it was built live; the
> counter is the menu and a two-column order rail, with the composer laid over the
> rail's left half and Bills this shift and Expenses in side-by-side panels below; an order taken
> with only a label shows that label as its card's headline on the counter and identifies the kitchen ticket by order number, offers it as the name when a new number is entered at payment, and keeps
> it nowhere once the order leaves the rail; a dish carries a short note from the
> composer that only the kitchen showing that dish sees, and the counter's card;
> every dish on a rail card is ticked off on its own and the order's **Prepared**
> follows the dishes, unticking itself when an edit adds food; a kitchen marks its
> part of a ticket **Ready**, the card collapses until counter handover, and those dishes show a Ready cue on
> the counter, silently, until ticked; food added after Ready reaches the kitchen
> as a new ticket, and food removed or cancelled after Ready reaches it not at all;
> a ticked or Ready dish takes no more and its note is fixed; each outlet's dish
> records are isolated, proved by a hand-crafted request; and the four-role demo
> walkthrough still walks, with a kitchen tab's Ready showing a cue on a counter tab's dish.

## Why

The kitchen tablet (#70) and the counter's bell (#72) are in daily use and
working. Trading on them showed what the counter still carries in people's heads
(owner, 2026-10-11):

- **"Whose is this?"** In a rush nobody has time to ask for a phone number while
  taking the order, and the name the counter can record needs one. The name, once
  recorded, sits behind the card's customer button — a tap per order to find out
  who is waiting. The counter wants a quick word on the order — a name, "red
  shirt", "table by the door" — that is there for the counter and gone after.
- **"Is it ready?"** The kitchen can say it has seen an order (ACK) but not that
  it has made it. The counter learns by walking over or shouting.
- **"Which bit is done?"** Prepared is one switch per order. An order of four
  dishes from two kitchens is prepared a dish at a time, and the counter can't
  record that.
- **"Did they change it again?"** An edit after the kitchen has made the food
  arrives as *EDITED* on a ticket the kitchen has already finished, showing food
  it has already handed over. The kitchen only needs what is new.
- **"No sauce, he said."** Small requests get forgotten between the counter and
  the kitchen.

The counter's middle column — Bills this shift with the cash and UPI totals — is
rarely looked at during service, while the order rail is where the counter works
and is short of room. The owner wants that room for the rail.

## What Changes

### The counter's layout

- **Two columns, not three**: the menu, and the order rail at about twice its
  width, its cards flowing in **two columns** — the same single list, newest
  first, packing each next ticket into the shorter column without row-height gaps.
- **Composing lays the composer over the rail's left half** — a new order or an
  edit. The rail does not squeeze; the cards underneath are simply covered until
  the order is saved, paid or abandoned.
- **Bills this shift and Expenses sit side by side below the workspace**, reached by
  scrolling down as Expenses is today. Taking a payment back or opening a receipt
  works there as it does now. Expenses align below the menu and Bills below the
  two-column orders rail at the same widths. Narrow screens scroll both rows
  sideways together without a tab switch. The records row fills another usable
  viewport; at the bottom only Bills and Expenses remain, with long lists scrolling
  within those panels and no blank scroll space below them.
- **Cash and UPI remain in the Bills panel only**. The header pill describes
  counter status and SHALL NOT include a money total. A short downward scroll
  reveals the payment split; search keeps its full menu-column width.

### The order label

- **A label field at the top of the composer**, one tap and a few letters,
  optional, never asking for a number.
- **The label is the card's headline** on the counter, beside the order number,
  with a compact age ring replacing the customer control. The kitchen uses the order number without the label.
- The counter age stays in total minutes, including beyond an hour, with a darker
  red from forty minutes. A gold star overlaps the order number without moving it.
- **At payment**, entering a number whose customer has a saved name uses that
  name. A new number, or one with no name, **suggests the label** as the name,
  editable.
- **Thrown away**: once the order leaves the rail — paid and every dish ticked, or
  cancelled, or finished by the day change — the label is gone. It never appears
  on a receipt, a bill, a report or an export.
- A label already used by another order on the rail is accepted with a quiet
  warning.

### Notes on a dish

- **A pencil at the right of the row, beside a compact quantity pill,** on each line in the composer opens a small sheet:
  a short text box (about 60 characters) under a row of quick chips — *No sauce*,
  *Extra spicy* and the like at first, then the notes this tablet uses most.
- **On a line of two or more, the sheet asks *All* or *Only 1***, so "two
  shawarmas, one without sauce" is two lines without a fight.
- The note shows **under its dish on the counter's card and on the kitchen's card
  of the kitchen that shows that dish**, nowhere else. Never on the receipt; it
  carries no price.

### Each dish is ticked off at the counter

- **Every dish on a rail card is tapped to tick it off** — its text turns orange
  and its separate checkbox fills and shows a check. The quantity stays visible. A mis-tap
  is tapped again.
- **Prepared follows the item ticks without a separate control**. Its footer space carries service/table information beside Paid, or one wide Paid when service is absent. Payment is unchanged; an order
  leaves the rail when it is paid and every dish is ticked, as today.
- Packaging is not a dish and is never ticked.

### Ready from the kitchen

- **The kitchen's card gains Done** beside the timer. A thick gray circle with a
  gray check and pale interior becomes filled green on click. Both states have
  the same diameter as the timer. Ready reaches the
  counter immediately; the ticket collapses to a gray header with an expand arrow
  in place of the timer. Clicking anywhere expands or collapses it. It remains undoable until its items are
  handed over at the counter, which starts the soft held-slot departure. Unticking
  restores the Done ticket. The kitchen uses responsive free-flowing columns.
- **On the counter, those dishes show a Ready checkbox cue** — silently: the counter
  faces customers and makes no sound. Ready keeps the normal text and an orange checkbox outline, with no row outline, and a localized cue until the biller ticks
  them when the food is handed over. The demo compares a soft halo, a breathing dot and a steady dot. Animated cues pulse together; reduced motion keeps them steady.
- **The pointer names it** — *↓ Ready #42* — while a ready order is scrolled out
  of sight. The dish's checkbox cue carries readiness without a per-card count.
- **Each kitchen has one stable indicator slot:** single tick when sent, orange
  double tick when acknowledged, bell when it has Ready food, and empty once its
  food is ticked at the counter. One kitchen changing never replaces another's mark.
- Two kitchens: each marks its own dishes ready; only those show a Ready cue.

### What the kitchen has made never comes back to it

- **A ticked or Ready dish is locked.** Tapping it again on the menu, or + on its
  line, starts a **new line** rather than raising its quantity; its note can no
  longer change. − still works, quietly.
- **Food added after Ready arrives as a new ticket** — *#42 · 2*, NEW, ringing like
  any new order, showing only what is new. A quantity raised on a Ready dish
  reaches the kitchen as *+1*.
- **Food removed after Ready, or an order cancelled after Ready, reaches the
  kitchen not at all**: it made that food already.
- An edit before Ready is still *EDITED*, as today — a kitchen still cooking must
  know to make fewer, or something different.

### Demo

- The demo's counter and kitchen tabs walk all of it: a kitchen tab's Ready signals readiness on
  the counter tab's dishes, a note travels with the dish; the label stays on the counter.
- The owner approved this demo on 11 October 2026, with the final request to
  remove the header total. Phase 1 is complete; the remaining database and live
  work continues in a separate chat. [Handoff](handoff.md) records the exact
  starting point and implementation boundaries.

## Non-goals

- **No sound on the counter**, for Ready or anything else.
- **No priced modifiers.** "Extra cheese +₹20" changes money and is its own change;
  a note never carries an amount.
- **No note on the whole order**, and no note on a packaging line.
- **No settings screen** for quick notes; the chips learn from the tablet's own use.
- **No kitchen screens beyond Ready.** No per-dish Ready in the kitchen, no prep
  timers, no kitchen analytics — though Ready and tick times are recorded, so prep
  and pickup times can be read later.
- **No change to payment, take-back, cancellation or the day change**, beyond the
  label being cleared and Prepared following the dishes.
- **No label in history.** Once an order leaves the rail its label is gone and
  cannot be recovered, by design; history knows the customer only as before.

## Capabilities

### Modified

- `counter-billing` — the two-column workspace with the composer over the rail;
  Bills and Expenses panels; the label, notes and locked dishes in the composer; dish
  ticks, service footer and age ring on the card; the Ready checkbox cue; the counter's
  kitchen read gaining readiness.
- `kitchen-display` — the card showing notes, food still owed and collapsed Done receipts;
  Ready with Undo; tickets after Ready.
- `order-lifecycle` — the label's lifetime; a dish's note; dish-level preparation
  and readiness, with the order's Prepared derived from its dishes; the kitchen's read gaining notes and readiness without the label.

## Impact

- **Database**: `orders.label`, `order_items.note`, a new outlet-scoped record of
  each dish's counter tick and of each kitchen's Ready, both with Row-Level
  Security and isolation tests; a new counter command for dish ticks; kitchen
  Ready and Undo; `revise_billing_order`, `prepare_billing_order`,
  `kitchen_board()` and `counter_kitchen_marks()` revised. No money column, no
  amount, no change to bill arithmetic.
- **Counter**: the workspace, composer, pipeline card, customer dialog's name
  suggestion, outbox (one new command), demo adapter, shimmer shapes.
- **Kitchen**: the board card and its actions.

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the counter's two-column
  workspace, the composer over the rail, Bills and Expenses panels, the label, notes,
  dish ticks and the Ready checkbox cue; the kitchen card's notes, Done receipts and
  tickets after Ready.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — `orders.label` and its
  clearing, `order_items.note`, the dish tick and Ready records, the order's
  Prepared derived from its dishes.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — the dish-tick
  command in the outbox; Ready and Undo being online-only kitchen actions.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — a
  kitchen shift marks Ready; a counter shift reads its outlet's Ready dishes.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — the
  label may hold a name: never logged, never exported, cleared when the order
  leaves the rail.
- [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md) — the Ready highlight
  and Ready cues, in both themes and under reduced motion.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — the two-tab walkthrough's
  Ready, label and note.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *label*, *note*, *Ready*,
  *ticket*, *locked dish*.
- [`docs/TESTING.md`](../../../docs/TESTING.md) — the new pgTAP and e2e coverage.
