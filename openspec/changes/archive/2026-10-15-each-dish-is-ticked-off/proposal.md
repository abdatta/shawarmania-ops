# Proposal: Each Dish Is Ticked Off

> **Model**: Opus · **Wave**: F · **Depends on**: **#75**, **#72**, #70, #69 · **Gate**: the
> owner approved the counter's new layout, the label, the dish ticks and the notes
> from demo screenshots on 11 October, and the Ready fill and handbell from an
> audition on 12 October, before any of it was relaunched; the counter is the menu
> and a two-column order rail, with the composer laid over the rail's left half and
> Bills this shift and Expenses in side-by-side panels below; an order taken with
> only a label shows that label as its card's headline on the counter, offers it as
> the name when a new number is entered at payment, and keeps it nowhere once the
> order leaves the rail; a dish carries a short note from the composer that only the
> kitchen showing that dish sees, and the counter's card; every dish on a rail card
> is ticked off on its own and the order's **Prepared** follows the dishes, unticking
> itself when an edit adds food; a kitchen marks its part of a ticket **Done**, the
> card collapses until counter handover, and on the counter those dishes fill orange
> and shine while a short handbell rings and the order's bell swings, until ticked;
> food added after Ready reaches the kitchen as a new ticket, and food removed or
> cancelled after Ready reaches it not at all; a ticked or Ready dish takes no more
> and its note is fixed; each outlet's dish records and labels are isolated, proved
> by a hand-crafted request; all of it ships behind the `dish-ticks` and
> `kitchen-ready` change gates, off, and each gate's Off is proved to be the counter
> and kitchen as they were, with nothing it saved stranded; the counter and kitchen
> stay inside #75's request budget with both gates on; and the four-role demo
> walkthrough still walks, with a kitchen tab's Ready filling a counter tab's dish.

> **Relaunch (re-planned 2026-10-14).** This change reached the counters on 12
> October 2026 and froze them under a polling flood: three one-second loops, none
> waiting for its last read. It was rolled back the same evening
> (`rollback-each-dish-is-ticked-off`), and the cause and its measurements are in
> #75's design, "Context". #75 then built what would have ended the incident in a
> minute — change gates, migrations that only add, a request budget in CI, a health
> line per tablet, and a staging outlet — and this change relaunches as its first
> real user. Nothing the owner approved changes. What changes is how it is built and
> released: behind two gates, off; every function the published counter calls left
> as it is and a `_v2` written beside it; no read on a timer; and through `stage`,
> the owner's walkthrough on *Cafe Staging*, a Promote, and a turn on the Change
> gates page at a quiet hour. Design → *Relaunch under #75* has every decision.

## Owner-approved Ready feedback (2026-10-12)

Billers missed silent readiness while dealing with customers and crowds, so the
owner reversed the original silent-counter decision after trying the sounds. This
supersedes the silent Ready checkbox cue the 11 October demo carried (design D9,
which records it as superseded). The audition's layout is not approved and is not
carried forward.

- **Sound:** the **Handbell, option 3** from the audition — a quick alternating bell
  sound, synthesised like the kitchen tablet's sounds. One burst per notification:
  a **four-strike figure (two high-low rings), played twice**, about three seconds,
  then it stops (owner, 14 October: the first build's two six-strike figures rang
  too long — the sound only has to make the biller look up).
- **Bell:** only that order's bell swings, for three times as long as the sound
  (9 s), so the biller who looks up finds which order rang; then it stops
  moving. No ongoing or periodically repeated ringing.
- **Handing over settles it.** Ticking the Ready food stops that order's swing at
  once, and the sound too when no order it was for is still owed. **Unticking never
  rings**: the alert is for news from the kitchen, and the biller made that change.
- **Dish:** when the kitchen marks it Ready, the **whole item row** fills with the
  theme's orange accent, its foreground inverted for legibility in light and dark.
  The existing checkbox stays, gray on the fill (owner, 14 October). A periodic shine, like the landing page's 5% off
  footer banner, crosses it until the biller marks the dish Prepared.
- **Prepared:** clears the orange fill and shine and returns to the normal check
  mark and orange text.
- **No Ready button on the counter**, no replacement control and no layout from the
  audition. Ready remains the kitchen's action; the counter keeps its checkbox.

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
  with a compact age ring replacing the customer control. The kitchen uses the
  order number without the label.
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

- **A pencil at the right of the row, beside a compact quantity pill,** on each
  line in the composer opens a small sheet: a short text box (about 60 characters)
  under a row of quick chips — *No sauce*, *Extra spicy* and the like at first,
  then the notes this tablet uses most.
- **On a line of two or more, the sheet asks *All* or *Only 1***, so "two
  shawarmas, one without sauce" is two lines without a fight.
- The note shows **under its dish on the counter's card and on the kitchen's card
  of the kitchen that shows that dish**, nowhere else. Never on the receipt; it
  carries no price.

### Each dish is ticked off at the counter

- **Every dish on a rail card is tapped to tick it off** — its text turns orange
  and its separate checkbox fills and shows a check. The quantity stays visible. A
  mis-tap is tapped again.
- **Prepared follows the item ticks without a separate control**. Its footer space
  carries service/table information beside Paid, or one wide Paid when service is
  absent. Payment is unchanged; an order leaves the rail when it is paid and every
  dish is ticked, as today.
- Packaging is not a dish and is never ticked.

### Ready from the kitchen

- **The kitchen's card gains Done** beside the timer. A thick gray circle with a
  gray check and pale interior becomes filled green on click. Both states have the
  same diameter as the timer. Ready reaches the counter at once; the ticket
  collapses to a gray header with an expand arrow in place of the timer. Clicking
  anywhere expands or collapses it. It remains undoable until its items are handed
  over at the counter, which starts the soft held-slot departure. Unticking
  restores the Done ticket. The kitchen uses responsive free-flowing columns.
- **On the counter, those dishes fill orange and shine, and the order's bell
  swings while the handbell rings** (above). The fill and shine stay until
  the biller ticks the dish when the food is handed over; the sound and the swing
  do not repeat. Under reduced motion the fill stays and the shine and swing do not
  move.
- **The pointer names it** — *↓ Ready #42* — while a ready order is scrolled out
  of sight.
- **Each kitchen has one stable indicator slot:** single tick when sent, orange
  double tick when acknowledged, bell when it has Ready food, and empty once its
  food is ticked at the counter. One kitchen changing never replaces another's mark.
- Two kitchens: each marks its own dishes ready; only those fill.

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

- The demo's counter and kitchen tabs walk all of it: a kitchen tab's Ready fills
  the counter tab's dishes and rings there, a note travels with the dish; the label
  stays on the counter.
- The demo runs both gates on by default, as every declared gate is (#75 D15); its
  Change gates page turns either off to compare, and the screens follow at once.

## Change gate

Two gates, the second dependent on the first. Each is off when it reaches
production, and the owner turns it on from the Change gates page at a quiet hour.

- **`dish-ticks`** (*DT*)
  - **On:** The counter is the menu and a two-column rail with Bills and Expenses
    below; orders take a label, dishes take notes, each dish is ticked off on its
    own, and the kitchen sees only the food it still owes.
  - **Off:** The counter and kitchen as they were before #74: three columns, one
    Prepared tick per order, no labels or notes.
- **`kitchen-ready`** (*KR*), **depends on `dish-ticks`**
  - **On:** The kitchen marks its food Done; on the counter those dishes fill orange
    and a short handbell rings while the order's bell swings.
  - **Off:** The kitchen has ACK only, as before #74.

**What Off does with what On saved.** On saves data the old counter and kitchen
must live with, so Off cannot simply be today for orders already on the rail. None
of it is a product choice — each answer is the old screens reading the rows as
they always have — but it is what the owner will see, so it is said here. Design
→ *R4* has the detail and the round-trip tests prove it.

- **A dish already ticked**: the old counter shows its order Prepared only once
  every dish was ticked; a partly ticked order reads unprepared, and the old
  kitchen board shows all of its food again — quietly, as acknowledged, never
  ringing.
- **A dish the kitchen marked Ready**: the same; Ready answered for ACK, so the old
  kitchen does not ring for it. With only `kitchen-ready` off, Ready food stays off
  the kitchen's board and the counter shows it as an ordinary unticked dish.
- **A note**: the old kitchen board does not show notes, so an order already taken
  with *No sauce* loses the words on the kitchen's screen. Say them aloud while the
  gate is off.
- **A label**: never shown by the old screens, and still cleared when the gate is
  next on (design R2).
- **Queued work** is never stranded: a dish tick or a labelled order queued while
  on is delivered after Off, to the functions it was written for.

**Version skew.** Every database object the on path needs is new: `_v2` functions
beside the ones the published counter calls, one new table for labels, and one
trigger on `orders` that does nothing unless `dish-ticks` is on. The tables and
columns #74's first launch added on 12 October stay as they are (design R2).

## Non-goals

- **No other sound on the counter.** The Ready handbell is the counter's only sound,
  one short burst per Ready and never repeated.
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
- **No read on a timer.** The relaunched counter reads when something tells it to —
  its own write, the kitchen pulse over Realtime, a return to the foreground — and
  never every few seconds (design R5).

## Capabilities

### Modified

- `counter-billing` — the two-column workspace with the composer over the rail;
  Bills and Expenses panels; the label, notes and locked dishes in the composer; dish
  ticks, service footer and age ring on the card; the Ready fill, shine and handbell;
  the counter's kitchen read gaining readiness.
- `kitchen-display` — the card showing notes, food still owed and collapsed Done
  receipts; Ready with Undo; tickets after Ready.
- `order-lifecycle` — the label's lifetime; a dish's note; dish-level preparation
  and readiness, with the order's Prepared derived from its dishes; the kitchen's
  read gaining notes and readiness without the label.

## Impact

- **Database**: one migration declaring the two gates; `order_labels`, a new
  outlet-scoped table with Row-Level Security and an isolation test; `_v2` of the
  order create and revise commands, the dish-tick command, kitchen Ready and Undo,
  the kitchen's ACK, `kitchen_board()` and `counter_kitchen_marks()`; one trigger on
  `orders`, inert unless `dish-ticks` is on. `order_items.note`,
  `order_line_preparations` and `kitchen_readies` already exist from 12 October and
  gain isolation tests again. No money column, no amount, no change to bill
  arithmetic, and no change to any function a published build calls.
- **Counter**: the workspace, composer, pipeline card, customer dialog's name
  suggestion, outbox routing (an optional field on a queued command), demo adapter,
  shimmer shapes, the handbell.
- **Kitchen**: the board card and its actions.
- **Request budget**: one dish tick joins the budget's readings (design R5).

## Docs To Update Before Archive

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the counter's two-column
  workspace, the composer over the rail, Bills and Expenses panels, the label, notes,
  dish ticks and the Ready fill and handbell; the kitchen card's notes, Done receipts
  and tickets after Ready.
- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — `order_labels` and its
  clearing, `order_items.note`, the dish tick and Ready records, the order's
  Prepared derived from its dishes, and the unused `orders.label`.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — the dish-tick
  command in the outbox, a command's `variant`, Ready and Undo being online-only
  kitchen actions.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — a
  kitchen shift marks Ready; a counter shift reads its outlet's Ready dishes and
  labels.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — the
  label may hold a name: never logged, never exported, cleared when the order
  leaves the rail.
- [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md) — the Ready fill and
  shine, in both themes and under reduced motion.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — the two-tab walkthrough's
  Ready, label and note.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *label*, *note*, *Ready*,
  *ticket*, *locked dish*.
- [`docs/TESTING.md`](../../../docs/TESTING.md) — the new pgTAP and e2e coverage.
- [`docs/RELEASES.md`](../../../docs/RELEASES.md) — the first real gate pair, and
  a command's `variant` as the way queued work reaches the functions it was written
  for.
