# Tasks

## 5. Repair live refresh latency

- [x] 5.1 Dish ticks release the counter after durable local acceptance, without waiting for pipeline or bill-history reads; serialize each order's projection and keep other tickets usable.
- [x] 5.2 Remove duplicate label polling, bound live fallbacks, and coalesce overlapping pipeline, bills, marks and kitchen reads with a trailing refresh.
- [ ] 5.3 Prove delayed reads cannot block accepted ticks, erase new Ready state or swallow post-Done refreshes; run the required gates and verify the production release.

## 1. The owner sees it first

Everything in this phase is built against the demo adapter on this change's branch
and merges only with the live half (design D10).

- [x] 1.1 Extend the adapter types and the mock adapter only: an order's `label`, a
  line's `note`, each item line's ticked quantity and ready quantity, a kitchen
  card's owed quantities and ticket number, and kitchen Ready and Undo. The demo
  scenario carries a labelled order, a noted dish, a two-kitchen order with one
  side Ready, a ticket after Ready and a paid order still cooking.
- [x] 1.2 The workspace: the menu and a free-flowing two-column rail, the composer
  laid over the rail's left half for new orders and edits, the editing pin in the
  uncovered half, one resize handle; Bills and Expenses side by side below the
  workspace, Expenses matching menu and Bills matching the rail, with linked sideways
  scrolling on narrow screens, records filling a second viewport without trailing blank scroll; the finished card's fade replacing the flight. Reshape
  the counter's loading shimmers for the new rail and panels in the same task.
- [x] 1.3 Cash and UPI atop the Bills panel only. Remove the trial header total
  per final owner approval; the pill carries counter status. Search keeps its full column width.
- [x] 1.4 The label: the composer's field, the quiet duplicate warning, the rail
  card's headline, and the customer dialog's name suggestion when the number has no
  saved name.
- [x] 1.5 Notes and locked lines: the right-aligned pencil beside a compact quantity pill, the sheet with its
  text box, quick chips (fixed seeds, then this tablet's most used, in local
  storage), *All* / *Only 1*; the composer's line key (design D4) and locked lines.
- [x] 1.6 The rail card: smaller separate dish checkboxes, orange ticked text,
  persistent orange Ready outline and synchronized expanding/fading pulse; hover
  shadow and hand cursor, original row widths, 6px spacing. Service/table details
  occupy the footer beside Paid; no aggregate Prepared. Compact age ring replaces
  the customer icon, total minutes centered with a darker red at 40 minutes; gold badge overlaid on number.
  One fixed slot per carrying kitchen: sent tick, orange ACK double tick, Ready bell,
  then empty after handover. Center service details. Demo mixes services with two legacy no-service cases.
- [x] 1.7 Kitchen cards: notes without labels, owed quantities and later tickets;
  equal timer-sized checked/unchecked Done circles, immediate counter signal, collapsed gray Done receipt
  with whole-card expansion/collapse, expand arrow replacing timer and unlimited Undo preserving handover.
  Counter handover removes it with a 320ms held-slot exit and 180ms blank gap;
  unticking restores it Done. Responsive N-column masonry and matching shimmer.
- [x] 1.8 Demo tabs share notes, Ready, Undo and handover. Later food creates a
  separate ticket beside the earlier collapsed Done receipt.
- [x] 1.9 **Owner approved 11 October 2026.** Capture at the counter's landscape-tablet width, light
  and dark: the rail with six orders; the composer over the rail during a new order
  and an edit; a card with a label, a noted dish, a ticked dish and a ready-cued
  dish; the note sheet on a line of two; the chosen totals placement; the Bills and
  Expenses panels; the kitchen cooking card with a note, collapsed/expanded Done receipt; a ticket *#N · 2*.
  Send them. Apply what the owner changes and record the decisions — the totals
  placement first — in `design.md`. The owner confirmed "rest looks good" and requested
  removal of the header total, final artifact reconciliation and a commit. Approval
  is recorded in D10 and `handoff.md`. The owner will continue everything below in
  a separate chat; none of the database/live work starts in this session.

## 2. Database

- [x] 2.1 Migration (dated after the newest on main), label and notes:
  `orders.label` (trimmed, 1–24 or null) with the trigger clearing it as the order
  leaves the rail and the paid-row guard admitting only that change;
  `order_items.note` (trimmed, 1–60 or null, item lines only); the create, revise and
  pay-now commands accept the optional keys, a blank label stored as none, an
  over-long one or a note on packaging refused as malformed, a note change on a
  locked line kept unchanged. Commands queued without the keys remain valid.
- [x] 2.2 Dish ticks: `order_line_preparations` with RLS (live counter shift at its
  outlet, Franchise Admin, owner; no direct write); the `prepare_order_lines` command
  in the billing envelope, owning tablet only, deriving the order's preparation
  (design D6) and keeping #69's day-change supersession; `prepare_billing_order`
  ticking or unticking every item line; `revise_billing_order` clearing an open
  order's counter-set preparation when a line is left unticked.
- [x] 2.3 Ready: `kitchen_readies` with RLS (the writing kitchen shift's outlet,
  Franchise Admin, owner; no direct write) and an append-only trigger;
  `kitchen_ready` and `kitchen_ready_undo` as design D5 describes, each bumping the
  outlet's pulse.
- [x] 2.4 Reads: `kitchen_board()` returns notes, owed quantities, Done receipts and the ticket number, and judges New, Edited and Cancelled on owed food since this
  tablet's latest Ready not undone; `counter_kitchen_marks()` returns ready
  quantities per line and each carrying kitchen's independent sent/ACK/Ready/handover state.
- [x] 2.5 Regenerate `database.types.ts` and check its diff.
- [x] 2.6 pgTAP: the label's lifecycle on every finishing path (counter tick, payment
  of a prepared order, day change, cancellation) and its absence from bills; notes
  and their refusals; dish ticks deriving and clearing preparation, a queued
  whole-order command, a tick after the day change; Ready, a stale Ready capping and
  leaving extra owed, Undo and its refusals; a ticket after Ready, silence after a
  removal or cancellation following Ready; two kitchens; the board omitting label and customer.
- [x] 2.7 **Isolation, `order_line_preparations`**: a counter shift, a kitchen shift
  and a Franchise Admin of one outlet each hand-craft a select of the other outlet's
  dish ticks and receive nothing; every client role's direct insert, update and
  delete is refused.
- [x] 2.8 **Isolation, `kitchen_readies`**: a kitchen shift, a counter shift and a
  Franchise Admin of one outlet each hand-craft a select of the other outlet's
  Readies and receive nothing; every client role's direct write is refused; a
  kitchen's Ready naming another outlet's order is refused.

## 3. Live

- [x] 3.1 The live adapter: label and notes on the order commands, the dish-tick
  command in the outbox with its optimistic state, Ready and Undo on the kitchen,
  ready quantities from the counter's kitchen read.
- [x] 3.2 Unit tests: the composer's line key and locked lines, *Only 1*, owed
  quantities and ticket numbers, Prepared following the dishes, the label's
  name suggestion, the quick-note ranking.
- [x] 3.3 Component tests: the workspace's overlay leaves the rail's cards in
  place; a dish tick and untick; no aggregate Prepared control; a ready line has a checkbox cue,
  animated cues pulse together and stop on tick; reduced motion; no audio element on the counter;
  the kitchen card's Ready and Undo.
- [x] 3.4 Playwright, a counter and a kitchen context against the local stack: a
  labelled order with a noted dish reaches the kitchen; Ready signals readiness on the counter's
  dish; ticking it stops it and finishes a paid order; food added after Ready
  arrives as *#N · 2*; food removed after Ready rings nothing; Undo restores the
  card.

## 4. Close

- [x] 4.1 Update `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`,
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`,
  `docs/DESIGN_SYSTEM.md`, `docs/DEMO_MODE.md`, `docs/GLOSSARY.md` and
  `docs/TESTING.md`.
- [x] 4.2 Run every gate CI runs, including contrast in both themes, the database and
  RLS suites and both e2e suites; walk the live-built counter and kitchen in both
  themes with console and network clean.
- [x] 4.3 **PHASE GATE.** Roadmap #74's checkpoint — the owner approved the counter's
  new layout, the label, the dish ticks, the notes and the Ready checkbox cue from demo
  screenshots before any of it was built live; the counter is the menu and a
  two-column order rail, with the composer laid over the rail's left half and Bills
  this shift and Expenses in side-by-side panels below; an order taken with only a label shows that
  label as its card's headline on the counter, offers it as the name
  when a new number is entered at payment, and keeps it nowhere once the order
  leaves the rail; a dish carries a short note from the composer that only the
  kitchen showing that dish sees, and the counter's card; every dish on a rail card
  is ticked off on its own and the order's **Prepared** follows the dishes,
  unticking itself when an edit adds food; a kitchen marks its part of a ticket
  **Ready**, the card collapses until counter handover, and those dishes show a Ready cue on the counter,
  silently, until ticked; food added after Ready reaches the kitchen as a new
  ticket, and food removed or cancelled after Ready reaches it not at all; a ticked
  or Ready dish takes no more and its note is fixed; each outlet's dish records are
  isolated, proved by a hand-crafted request; and the four-role demo walkthrough
  still walks, with a kitchen tab's Ready showing a cue on a counter tab's dish.
