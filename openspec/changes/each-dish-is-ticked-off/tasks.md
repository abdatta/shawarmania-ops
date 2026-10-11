# Tasks

## 1. The owner sees it first

Everything in this phase is built against the demo adapter on this change's branch
and merges only with the live half (design D10).

- [ ] 1.1 Extend the adapter types and the mock adapter only: an order's `label`, a
  line's `note`, each item line's ticked quantity and ready quantity, a kitchen
  card's owed quantities and ticket number, and kitchen Ready and Undo. The demo
  scenario carries a labelled order, a noted dish, a two-kitchen order with one
  side Ready, a ticket after Ready and a paid order still cooking.
- [ ] 1.2 The workspace: the menu and a two-column rail in reading order, the composer
  laid over the rail's left half for new orders and edits, the editing pin in the
  uncovered half, one resize handle; Bills and Expenses tabs below the workspace,
  remembered on the tablet; the finished card's fade replacing the flight. Reshape
  the counter's loading shimmers for the new rail and tabs in the same task.
- [ ] 1.3 The Cash and UPI tiles in both placements of design D1 — (A) atop the
  Bills tab with a one-line total in the header pill, (B) a strip across the rail —
  switchable in the demo only, for the owner's choice.
- [ ] 1.4 The label: the composer's field, the quiet duplicate warning, the rail
  card's headline, and the customer dialog's name suggestion when the number has no
  saved name.
- [ ] 1.5 Notes and locked lines: the ⓘ control beside − and +, the sheet with its
  text box, quick chips (fixed seeds, then this tablet's most used, in local
  storage), *All* / *Only 1*; the composer's line key (design D4) and locked lines.
- [ ] 1.6 The rail card: notes under dishes, a tap target per dish line that fills
  its quantity tile with a check, Prepared drawn as a statement following the
  dishes, the *n ready* mark, the Ready border and burst shake (reduced-motion fade),
  and the scroll pointer naming a ready order. Add the Ready border and mark as
  semantic tokens in both themes; no hex in a component.
- [ ] 1.7 The kitchen card: label under the number, notes under dishes, owed
  quantities, *#N · n* for a later ticket, Ready beside ACK, the ten-second Undo, and
  the mock's ticket rules (design D7).
- [ ] 1.8 The demo's two tabs: a kitchen tab's Ready shakes the counter tab's dishes;
  a label and a note reach the kitchen tab; food added after Ready rings there as a
  new ticket; food removed after Ready rings nothing.
- [ ] 1.9 **STOP for the owner.** Capture at the counter's landscape-tablet width, light
  and dark: the rail with six orders; the composer over the rail during a new order
  and an edit; a card with a label, a noted dish, a ticked dish and a shaking ready
  dish; the note sheet on a line of two; both totals placements; the Bills and
  Expenses tabs; the kitchen card with a label, a note and Ready; a ticket *#N · 2*.
  Send them. Apply what the owner changes and record the decisions — the totals
  placement first — in `design.md`. Nothing below starts until the owner approves.

## 2. Database

- [ ] 2.1 Migration (dated after the newest on main), label and notes:
  `orders.label` (trimmed, 1–24 or null) with the trigger clearing it as the order
  leaves the rail and the paid-row guard admitting only that change;
  `order_items.note` (trimmed, 1–60 or null, item lines only); the create, revise and
  pay-now commands accept the optional keys, a blank label stored as none, an
  over-long one or a note on packaging refused as malformed, a note change on a
  locked line kept unchanged. Commands queued without the keys remain valid.
- [ ] 2.2 Dish ticks: `order_line_preparations` with RLS (live counter shift at its
  outlet, Franchise Admin, owner; no direct write); the `prepare_order_lines` command
  in the billing envelope, owning tablet only, deriving the order's preparation
  (design D6) and keeping #69's day-change supersession; `prepare_billing_order`
  ticking or unticking every item line; `revise_billing_order` clearing an open
  order's counter-set preparation when a line is left unticked.
- [ ] 2.3 Ready: `kitchen_readies` with RLS (the writing kitchen shift's outlet,
  Franchise Admin, owner; no direct write) and an append-only trigger;
  `kitchen_ready` and `kitchen_ready_undo` as design D5 describes, each bumping the
  outlet's pulse.
- [ ] 2.4 Reads: `kitchen_board()` returns the label, notes, owed quantities and the
  ticket number, and judges New, Edited and Cancelled on owed food since this
  tablet's latest Ready not undone; `counter_kitchen_marks()` returns ready
  quantities per line and applies the same rule for the bell.
- [ ] 2.5 Regenerate `database.types.ts` and check its diff.
- [ ] 2.6 pgTAP: the label's lifecycle on every finishing path (counter tick, payment
  of a prepared order, day change, cancellation) and its absence from bills; notes
  and their refusals; dish ticks deriving and clearing preparation, a queued
  whole-order command, a tick after the day change; Ready, a stale Ready capping and
  leaving extra owed, Undo and its refusals; a ticket after Ready, silence after a
  removal or cancellation following Ready; two kitchens; the board carrying the label
  and never the customer.
- [ ] 2.7 **Isolation, `order_line_preparations`**: a counter shift, a kitchen shift
  and a Franchise Admin of one outlet each hand-craft a select of the other outlet's
  dish ticks and receive nothing; every client role's direct insert, update and
  delete is refused.
- [ ] 2.8 **Isolation, `kitchen_readies`**: a kitchen shift, a counter shift and a
  Franchise Admin of one outlet each hand-craft a select of the other outlet's
  Readies and receive nothing; every client role's direct write is refused; a
  kitchen's Ready naming another outlet's order is refused.

## 3. Live

- [ ] 3.1 The live adapter: label and notes on the order commands, the dish-tick
  command in the outbox with its optimistic state, Ready and Undo on the kitchen,
  ready quantities from the counter's kitchen read.
- [ ] 3.2 Unit tests: the composer's line key and locked lines, *Only 1*, owed
  quantities and ticket numbers, Prepared following the dishes, the label's
  name suggestion, the quick-note ranking.
- [ ] 3.3 Component tests: the workspace's overlay leaves the rail's cards in
  place; a dish tick and untick; Prepared cannot be tapped; a ready line shakes,
  bursts again, and stops on tick; reduced motion; no audio element on the counter;
  the kitchen card's Ready and Undo.
- [ ] 3.4 Playwright, a counter and a kitchen context against the local stack: a
  labelled order with a noted dish reaches the kitchen; Ready shakes the counter's
  dish; ticking it stops it and finishes a paid order; food added after Ready
  arrives as *#N · 2*; food removed after Ready rings nothing; Undo restores the
  card.

## 4. Close

- [ ] 4.1 Update `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`,
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`,
  `docs/DESIGN_SYSTEM.md`, `docs/DEMO_MODE.md`, `docs/GLOSSARY.md` and
  `docs/TESTING.md`.
- [ ] 4.2 Run every gate CI runs, including contrast in both themes, the database and
  RLS suites and both e2e suites; walk the live-built counter and kitchen in both
  themes with console and network clean.
- [ ] 4.3 **PHASE GATE.** Roadmap #74's checkpoint — the owner approved the counter's
  new layout, the label, the dish ticks, the notes and the Ready shake from demo
  screenshots before any of it was built live; the counter is the menu and a
  two-column order rail, with the composer laid over the rail's left half and Bills
  this shift and Expenses in tabs below; an order taken with only a label shows that
  label as its card's headline on the counter and the kitchen, offers it as the name
  when a new number is entered at payment, and keeps it nowhere once the order
  leaves the rail; a dish carries a short note from the composer that only the
  kitchen showing that dish sees, and the counter's card; every dish on a rail card
  is ticked off on its own and the order's **Prepared** follows the dishes,
  unticking itself when an edit adds food; a kitchen marks its part of a ticket
  **Ready**, the card leaves its board, and those dishes shake on the counter,
  silently, until ticked; food added after Ready reaches the kitchen as a new
  ticket, and food removed or cancelled after Ready reaches it not at all; a ticked
  or Ready dish takes no more and its note is fixed; each outlet's dish records are
  isolated, proved by a hand-crafted request; and the four-role demo walkthrough
  still walks, with a kitchen tab's Ready shaking a counter tab's dish.
