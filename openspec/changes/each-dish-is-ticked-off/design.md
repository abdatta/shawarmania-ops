# Design: Each Dish Is Ticked Off

## Read this first

This change went live on 12 October 2026, froze the counter, and was rolled back
that evening. It relaunches under #75 (`a-release-can-be-switched-off`). Decisions
D1–D11 below are the first launch's, and the owner approved their screens on 11
October; they stand except where *Relaunch under #75* (R1–R10) replaces them, and
each replaced passage says so where it sits. The decisions most often got
backwards:

1. **Off is the counter and kitchen exactly as they are today.** The old files,
   functions and requests are not edited, not even into something that "behaves the
   same". The on path is new files and new `_v2` functions beside them (R7, R2).
2. **No read on a timer.** The 12 October flood was three one-second loops. The
   on path reads when its own write, the kitchen pulse, the foreground or the
   network tells it to, exactly as the off path does, and nothing else (R5).
3. **The outbox never reads a gate.** A queued command carries the function family
   it was written for, in an optional envelope field, so a dish tick queued while
   on still reaches `prepare_order_lines_v2` after the gate is off (R3).
4. **Labels are not on `orders`.** `orders.label` exists from the first launch, but
   the order guard the rollback restored refuses any change to it. Labels live in
   `order_labels` (R8). Do not "fix" the guard: it is a function every published
   build's writes run through.
5. **The Ready signal is the 12 October one** — whole-row orange fill, a periodic
   shine, a short burst of the audition's Handbell option 3 with the order's bell
   swinging longer — not D9's silent checkbox pulse, and not the audition's layout (R6).
6. **A first read rings nothing.** A page that loads (a gate turn reloads every
   tablet) must not ring for Readies it merely finds (R6).

## Relaunch under #75

### R1. Two gates: `dish-ticks`, and `kitchen-ready` depending on it

`dish-ticks` (*DT*) is everything but Ready: the two-column workspace with the
composer over the rail and the records panels below; labels; notes and locked
lines; per-dish ticks with Prepared drawn as a statement; the card's age ring,
overlaid gold badge and service footer; the kitchen's card showing notes and only
food still owed; each kitchen's sent / ACK / handed-over slot on the counter.

`kitchen-ready` (*KR*), dependent on DT, is Ready: the kitchen's Done control,
collapsed Done receipts and Undo; a later ticket's *#N · n*; the counter's orange
fill, shine, handbell and bell swing; the slot's Ready bell; *↓ Ready #N*.

With DT on and KR off, the kitchen has ACK only on the new card, the counter ticks
dishes, and nothing rings at the counter. With KR's rows already written, Ready
food stays off the kitchen's board (it was made) and reads on the counter as an
ordinary unticked dish (R4).

**Rejected:** *one gate* — Ready is the riskiest part to turn on (the counter's only
sound, and the kitchen's new habit), and the owner may want the ticks without it;
*a third gate for the layout* — the layout exists to give the rail room for the
ticks and the composer overlay, it has no use alone, and a third root gate adds a
state to test for nothing the owner would turn separately; *Ready not depending on
the ticks* — Ready's whole effect on the counter is on a dish row only the ticks
draw.

### R2. What already exists, and what the relaunch adds — version skew

The first launch's two migrations (`20261016000000`, `20261016010000`) are
published and stay. The rollback's corrective migration (`20261017000000`, the
expand-only lint's baseline) restored ten functions to their pre-#74 bodies. The
relaunch's one migration only adds, and declares `-- change-gate: dish-ticks`.

| Object | In production today | Relaunch |
|---|---|---|
| `orders.label` + `orders_label_shape` | Added 12 Oct, unused; the restored `billing_order_guard` refuses any change to it on update | Unused. Labels go to `order_labels` (R8). Dropped by #74's retirement contract. |
| `order_items.note` + `order_items_note_shape` | Added 12 Oct; old functions accept a `note` key and drop it | Written by `create_billing_order_v2` / `revise_billing_order_v2`. Old reads select `order_items(*)` and ignore the extra field. |
| `order_line_preparations` (RLS) | Added 12 Oct with a backfill; rows from 12 Oct | Written by `prepare_order_lines_v2`, read by the on path's order read. Old builds never read it. |
| `kitchen_readies` (RLS, append-only) | Added 12 Oct; rows from 12 Oct | Written by `kitchen_ready_v2` / `kitchen_ready_undo_v2`. |
| `billing_commands.command_type` check | Includes `prepare_order_lines` since 12 Oct | Unchanged. `_v2` commands record the same types. |
| `billing_envelope_error`, `billing_validate_lines`, `billing_dish_payload_ok` | 12 Oct bodies: accept optional `label` / `note` keys | Unchanged; called by `_v2` as by the old functions. |
| `create_billing_order`, `revise_billing_order`, `prepare_billing_order`, `pay_billing_now`, `kitchen_board`, `counter_kitchen_marks`, `kitchen_acknowledge`, `kitchen_visible_lines`, `kitchen_same_lines`, `billing_order_guard` | Restored pre-#74 bodies; the off path calls them | Untouched. The on path calls `create_billing_order_v2`, `revise_billing_order_v2`, `kitchen_board_v2`, `counter_kitchen_marks_v2`, `kitchen_acknowledge_v2`. |
| `prepare_order_lines`, `kitchen_ready`, `kitchen_ready_undo`, `dish_ready_quantity`, `dish_line_locked`, `derive_dish_preparation`, `kitchen_owed_lines`, `kitchen_ticket`, `kitchen_done_lines` | 12 Oct bodies; no published build calls them except a tablet still holding a 12 Oct `prepare_order_lines` | Untouched and uncalled by the relaunch. The on path calls `prepare_order_lines_v2`, `kitchen_ready_v2`, `kitchen_ready_undo_v2` and `_v2` helpers whose bodies this change owns (R4's rules differ from the 12 Oct ones, and a published function cannot be corrected). |
| `pay_billing_order`, `pay_billing_now`, `cancel_billing_order`, `unpay_billing_order`, `cancel_paid_billing_order`, `manager_cancel_billing_order`, the day change | Unchanged | Shared by both paths, unchanged. Pay-now makes a bill with no order, so nothing for a label or note to attach to; the on path sends neither. |
| `order_labels` (new, RLS) | — | New table (R8), isolation-tested. |
| `orders_label_leaves_the_rail` (new trigger on `orders`) | — | `after update`, returns at once unless `app_change_gate('dish-ticks')` (R8). |
| `change_gates` rows `dish-ticks`, `kitchen-ready`; `change_gate_dependencies` row | — | Inserted off. |

Every `_v2` function is first created by a migration declaring `dish-ticks`, so a
later fix during staging may `create or replace` it (#75 D8).

### R3. A queued command carries the functions it was written for

The outbox delivers whatever it holds and never reads a gate (#75 D7). But the on
path's order commands must reach `_v2` functions and the off path's must reach the
old ones, and the command *type* cannot change: `billing_commands.command_type`'s
check would need a new value, which is a new constraint on an existing table.

So the envelope gains an optional field, **`variant: 'dishes'`**, set by the on
path's adapter when it accepts a command and never by the off path's. The RPC is
chosen from `(type, variant)`: `create_order`, `revise_order` and
`prepare_order_lines` with `variant: 'dishes'` go to their `_v2`; everything else,
and every envelope without the field, goes where it goes today. The field is
envelope metadata, outside the payload, so the payload's hash and the server's
replay check are unchanged, and an off-path envelope is byte-for-byte today's. A
command keeps its variant for its whole life, so one queued while on is delivered
to `_v2` after the gate turns off — the functions it was written for, which stay
published while the gate exists.

**Rejected:** routing by the gate at delivery (the outbox would read a gate, and a
command would change meaning with the gate under it); routing by the payload's
contents, such as a `label` key (an on-path revision with no label must still reach
`_v2`, which derives Prepared from the ticks); new command types (a new value in an
existing check constraint).

### R4. Rows the other path wrote

Each path meets rows the other wrote, in both directions and while the gate turns.
The round-trip tests (`@cg-round-trip:dish-ticks`, `@cg-round-trip:kitchen-ready`)
prove these.

- **An order the old path prepared** has `prepared_at` set and item lines with no
  tick row — the old Prepared tick, a whole-order `set_order_preparation` queued
  while off and delivered while on, or the day change. The on path reads **every
  item line of a prepared order as ticked**, server and client. Before an untick,
  `prepare_order_lines_v2` writes tick rows for the order's untouched item lines
  (at the order's preparation time, attributed to the command), so unticking one
  dish never unticks the rest.
- **On-path ticks on the off path**: the old counter shows Prepared exactly when
  every dish was ticked (`prepared_at` is derived from the ticks); a partly ticked
  order reads unprepared.
- **Acknowledgements are full snapshots on both paths.** `kitchen_acknowledge_v2`
  records the kitchen's visible lines, notes included, as the old function records
  them without notes. The v2 board subtracts the current handover and Ready from
  both sides when it compares, so a tick after an ACK stays silent; the old board
  compares as it always has. So after DT turns off, an acknowledged order with
  food already handed over shows on the old kitchen board in full and quiet, never
  ringing.
- **Ready answers for ACK in the data.** `kitchen_ready_v2` records an
  acknowledgement of the order's current version when the kitchen has none for it,
  timed just before the Ready. The old board and the old bell therefore read a
  Done order as seen, and the v2 board, which judges only acknowledgements after
  the latest Ready, is unaffected.
- **With KR off and DT on**, the v2 board still counts Ready food as made (it is
  owed nothing) but the kitchen draws no Done receipt, and the counter draws a Ready
  dish as unticked with no fill.
- **Notes with DT off**: the old kitchen board does not show them.
- **Labels with DT off**: nothing clears a label while off. The on path's next
  `create_billing_order_v2` at that outlet deletes every label of an order already
  off the rail; until then no screen reads them (R8).
- **An on → off → on trip** in which a kitchen ACKed a noted order while off
  leaves an acknowledgement without notes; the v2 comparison keys a dish by its
  note, so that order reads *Edited* once. Accepted: it needs the gate turned twice
  inside one order's life.

### R5. No read on a timer, and the request budget

The first launch added a one-second pipeline reload, a one-second label lookup and
a one-second demo review refresher (left mounted live), then a repair with
ten- and five-second fallbacks. The relaunch adds **no timer that reads the
network**:

- The counter reads as it does today: the rail after its own writes, the kitchen
  marks on mount, after a rail reload and on the kitchen pulse (Realtime), and on a
  return to the foreground or the network. The on path's marks read is
  `counter_kitchen_marks_v2` in place of the old one, not beside it.
- A dish tick is one command; the rail reloads after it as after any write, and
  the tick's pulse brings the marks read the bell already makes.
- The duplicate-label warning reads the rail already in memory.
- The demo's two-tab mirror is the demo's own channel and is never mounted in the
  live tree.
- The kitchen reads as it does today — the pulse, the twenty-second visible re-read,
  the foreground — with one change kept from the first launch's repair, in the on
  path only: a read asked for while one is in flight runs once after it instead of
  being dropped, so a Done's own refresh is never lost.
- Local timers that read nothing stay: the age ring's clock, the shine's CSS
  animation, the ring burst.

`e2e-auth/request-budget.spec.ts` gains **one dish tick** among its readings, and
the budget holds with both gates on. The readings and their date are recorded in
the test, as #75 recorded its own.

**What each read costs.** Measured 2026-10-14 on the local stack, as the counter
and kitchen one of a seeded rail — eight open orders across two kitchens with
disjoint filters, four acknowledged, two Ready, two partly ticked — each read
fifty times after a warm-up, four runs:

| Read | Old (ms) | `_v2` (ms) |
|---|---|---|
| `counter_kitchen_marks` | 5.56, 4.90, 5.16, 5.58 | 5.69, 4.79, 5.45, 5.44 |
| `kitchen_board` | 1.63, 2.17, 1.95, 2.57 | 3.06, 2.96, 2.76, 3.26 |

The counter's read — the one 12 October measured at 373 ms under load — costs
the same. The kitchen's costs about a millisecond more, the price of working out
what is still owed, on a read a kitchen makes on the pulse and every twenty
seconds. The first draft cost four times as much: Postgres inlined each
single-use CTE and evaluated every per-kitchen function once per reference, so the
CTEs holding them are `materialized`, and a kitchen's ticket and receipts are
worked out only where it shows the food, has acknowledged the order or marked it
Ready.

### R6. Ready on the counter: fill, shine, a handbell burst, the bell swings

From the owner's 12 October approval (proposal).

- **Fill.** A dish line whose ready quantity exceeds its ticked quantity fills its
  whole row with the theme's orange accent (`--ready`), its text and quantity in the
  inverse foreground (`--on-ready`), both semantic tokens, contrast-validated in
  both themes. The checkbox stays, gray on the fill: the waiting checkbox's border
  over the card's own surface (owner, 14 October). Ticking returns the row to the
  ticked look (orange text, filled checkbox).
- **Shine.** A light band crosses the filled row every few seconds, the landing
  page's offer-banner shine, in CSS only. Reduced motion: no shine, the fill stays.
- **Sound.** The audition's **Handbell, option 3**, recovered verbatim from its
  code (12 October): struck sine partials at 1, 2.76 and 5.4 × 1175 Hz (levels 0.5,
  0.2, 0.06), strikes 0.22 s apart with every other strike at 0.8 × the pitch,
  3 ms attack, each partial decaying over 1.4 s / √ratio, through a 0.65 gain into a
  limiter (−10 dB threshold, 20:1, hard knee, 1 ms attack, 120 ms release).
  The first build rang the audition's six-strike figure twice (12 October, "two
  times is good enough"); on hearing it at the counter the owner found it too long
  (14 October): the sound only has to bring the biller's eyes to the screen, and the
  swinging bell and the orange row then say which order. So a figure is **four
  strikes — two high-low rings — faded out by 1.5 s, and a burst is that figure
  played twice, 3 s** (owner: "repeating once what we are already playing").
  Synthesised with Web Audio like the kitchen's tunes; no file. The owner
  confirms it by ear on staging, where any change is to these numbers only.
- **When.** A burst plays when a Ready **arrives**: a line's ready quantity — the
  kitchen's number, never the counter's ticks — rises above what this page last
  read, and exceeds what the counter has ticked. So an **untick rings nothing**
  (owner, 14 October: the biller made that change), and nor does a tick, an Undo or
  food ticked before the kitchen pressed Done. The first read after a page loads rings nothing
  and swings nothing (a gate turn reloads every tablet). Readies arriving in one
  read share one burst; a Ready arriving during a burst swings its bell at once and
  gets one more burst after it, never more than one queued.
- **Swing.** The arriving order's Ready bell in its kitchen slot swings for 9 s,
  three times the sound, then stops. Reduced motion: no swing.
- **Handover settles it.** When a read finds an order with no Ready food left
  untaken — the biller ticked it, an Undo took it back, or the order left the rail —
  its bell stops swinging at once; when no order the playing sound is for is still
  owed, the sound stops and a queued burst for it is dropped (owner, 14 October).
- **Audio unlock.** Browsers hold sound until the page is touched; the counter is
  touched constantly, and every tap unlocks. A Ready arriving before the first tap
  after a reload shows the fill and swing without sound.

**Rejected:** a Ready button or any control on the counter (owner: Ready is the
kitchen's); repeating the sound until ticked (owner: one short burst, then stop); ringing for
the counter's own unticks; the
audition's layout (owner: "it looks ugly").

### R7. Where the code forks

`useChangeGate('dish-ticks')` is read where the counter and the kitchen choose
their screen: `counter-shell.tsx` for the counter's layout and
`kitchen/kitchen-screen.tsx`, which picks the old board or
`dish-kitchen-board-screen.tsx`. Where #74 rewrote a component wholesale, the on
path is a fork beside the old file, which keeps today's body: `dish-open-orders-surface.tsx`
beside `open-orders-surface.tsx` (chosen in `counter-activity.tsx`),
`DishKitchenMarksProvider` beside the old provider in `kitchen-marks.tsx`, and
`dish-kitchen-board-screen.tsx`, `dish-kitchen-card.tsx` and
`use-dish-kitchen-board.ts` in `src/features/kitchen/`. New pieces are new files
(`ready-dish.tsx`, `handbell.ts`, `use-ready-ringer.ts`, `counter-records.tsx`).
Where #74 only added to a shared component — the composer (`billing-counter.tsx`),
the rail card (`pipeline-card.tsx`), the bill panel, the menu grid, the footer and
*My shift* — it branches on a prop or the gate's answer, and the off branch is
today's markup and classes verbatim. `kitchen-ready` is read inside the on path's
screens. A planned `src/features/dish-ticks/` folder was not used: forking the
composer and the rail card whole would have doubled two of the largest files for
a few branches each.

Shared domain helpers keep their bodies (`lineKey` in `domain/service.ts`, the
kitchen's `lineKey`, `kitchenWaitTone`); the first launch edited them, which
changed the off path, and the on path now has its own (`dishLineKey`,
`dishWaitTone`, …) in `src/domain/dish-workflow.ts`.

The live billing and kitchen adapters are constructed with the page's boot answer
for `dish-ticks`, as the Supabase client is constructed with `tablet-health`'s
(#75 D13): with it off their reads and writes are today's, request for request;
with it on, the order read embeds labels and ticks and the order commands carry
`variant: 'dishes'`. The demo's mock adapters ask the demo's current answers on
each call, because a demo turn takes effect at once while its data stays (#75 D15).

### R8. Labels live in `order_labels`

```
order_labels
  order_id uuid pk references orders
  outlet_id uuid references outlets
  label text  -- trimmed, 1–24
```

RLS: a live counter shift at its outlet, its Franchise Admins and the owner select;
no client role writes; no kitchen select (the kitchen never sees a label).
`create_billing_order_v2` and `revise_billing_order_v2` write or delete the row;
the on path's order read embeds it, so a label costs no request of its own.

**Clearing.** `orders_label_leaves_the_rail`, an `after update` trigger on
`orders`, deletes the order's label once the row is cancelled or paid with
`prepared_at` set — every path that finishes an order, the old ones and the day
change included — and returns at once while `dish-ticks` is off. With the gate
off, a label of an order that leaves the rail stays until the on path's next
create at that outlet deletes every such label (R4); no screen reads it meanwhile.

**Rejected:** `orders.label`, the first launch's column — the guard restored by the
rollback refuses changing it, and replacing the guard is replacing a function
every published build's writes run through; a session variable read by a trigger
ordered after the guard (works, and is a trap for the next reader); clearing by a
nightly sweep (D2's own rejection).

### R9. Release

Push to `stage` with the owner's go-ahead; Staging runs the suite in both states
and publishes `stage-ops.shawarmania.in`. The owner turns DT, then KR, on in
staging's Change gates page and runs *Cafe Staging* as an outlet — the laptop in
Brave as the counter, the Android phone in Chrome as the kitchen — including the
handbell by ear. An agent runs `npm run test:e2e:staging`. Then a Promote in the
owner's deploy window ships both off; `/release dish-ticks` at a quiet hour,
watching each tablet's requests on the gate's page through the next service; one
pull, off and on; then `kitchen-ready` the same way. Archive waits for real use and
the pull (#75 D11).

### R10. What the first launch's decisions lose

- **D2**'s label column and its clearing inside the order guard → R8.
- **D9**'s silent checkbox cue (the pulsing dot the owner chose on 11 October) → R6.
  The rest of D9 — ticked text, checkbox geometry, the age ring, the slots, the
  kitchen's Done — stands.
- **D10**'s "nothing merges before the live half" → the gates: everything merges,
  and ships off.
- **D11**'s ten- and five-second fallbacks → R5. Its first half stands: a tick and a
  payment release the card on local acceptance, never waiting on a read.
- The first launch's verification log is at `9e916642` in history; this change
  writes a new one.

## The approved UI contract (11 October 2026)

Carried from the first launch's handoff, as the owner approved it; R6 replaces only
its Ready cue.

- Counter: menu plus two-column shortest-column masonry rail; one resize handle.
  New/edit composer overlays the left half without reflowing underlying cards; an
  editing pin and single footer occupy the uncovered right half.
- Records: Expenses under menu, Bills under the two-column rail, matching widths
  after resizing. Both rows retain sideways scroll and share its position on narrow
  devices. Records fill a second usable viewport; at maximum page scroll only
  records are visible below persistent chrome. Long lists scroll inside their
  panels. Keep menu layout/paint containment, shell overflow clipping and flex gaps
  that exclude closed dialogs; otherwise trailing blank scroll returns.
- Money: Cash/UPI totals remain **inside Bills only**. The header pill contains
  sync, shift time and applicable kitchen-offline status, with no money total.
- Counter dishes: separate visible quantity, fixed 15px checkbox, left inset taken
  from the existing gap, 6px row spacing, centered text, mouse pointer and subtle
  hover shadow. Ticked text/checkbox are orange; no filled row once ticked. Waiting
  is gray.
- No aggregate Prepared button. Center Table/Dine-in/Takeaway beside Paid, or use
  full-width Paid when service is absent. Payment and its take-back safety remain
  unchanged. Customer details remain in Paid, edit and overflow.
- Compact counter timer replaces the customer icon in its existing footprint:
  centered numeric **total minutes**, including 84 rather than 1h; warning 10,
  danger 20, darker contrast-validated red 40. Gold star overlays the order number
  without consuming header width.
- Every carrying kitchen owns a stable independent status slot: sent single tick →
  orange ACK double tick → Ready bell → empty after handover. Handover, Ready, Undo
  and later food change only the appropriate kitchen.
- Composer: Order Label placeholder with hidden accessible caption, compact quantity
  pill, amount then rightmost pencil, and unwrapped Save. Label lifetime, quick-note
  ranking, All/Only 1, locks and waiting-draft restore.
- Kitchen: responsive N-column shortest-column masonry. No label or customer data.
  Gray Done circle beside the timer, visible check and pale fill, thick outline;
  checked green circle and unchecked circle match the timer diameter. Done sends
  Ready **immediately**, collapses a muted gray receipt and replaces the timer with
  an expand arrow. Whole-card click toggles both directions; Undo remains available
  at any time. No countdown, no automatic time-based disappearance.
- Each Done receipt remains distinct from a later cooking ticket *#N · 2*. Counter
  handover consumes older receipts first. Only complete handover removes it: 320ms
  soft fade and 4% shrink in its original slot, 180ms held blank gap, then the
  masonry repacks. Unticking an unfinished order restores its gray Done receipt.
  Kitchen Undo never erases counter handover. Removed or cancelled food already made
  never reappears as kitchen work.

## Context

Today an order is prepared or not as a whole: `orders.prepared_at` and
`prepared_source`, set by `prepare_billing_order` from the owning tablet and by
the day change (#69). The kitchen (#70) reads unprepared orders through
`kitchen_board()`, compares each card's visible lines against its latest
acknowledgement snapshot (`kitchen_acknowledgements.lines`, read through today's
filter since #72 D7), and rings New, Edited or Cancelled until ACK. The counter's
bell (#72) reads `counter_kitchen_marks()`, which applies the same comparison per
kitchen and returns waiting, seen or not shown.

Line identity is already stable across revisions: `revise_billing_order` upserts
`order_items` by id and deletes lines that are gone, and the counter sends each
captured line under its stored id (`an-edit-keeps-its-captured-lines`). A line
can therefore carry facts across edits.

The counter workspace is three columns (`billing-counter.tsx`): the menu, a
middle column showing `MyShiftSurface` (method totals and Bills this shift) that
the composer replaces while composing, and the activity rail. Expenses sit below
the workspace in `counter-shell.tsx`.

## Goals

- The counter knows, without asking, who an order is for, what was asked for
  beyond the menu, which dishes are made and which are handed over.
- The kitchen sees food it still owes and collapsed Done tickets awaiting counter handover.
- Nothing about money, bill numbering, payment or the day change moves.

## Decisions

### D1. The workspace is the menu and a two-column rail; the composer is laid over the rail

The middle column goes. The rail takes its width and lays its single list out in
two free-flowing columns. The single list remains newest first; each next card
goes in the shorter column, leaving only the normal gap beneath the previous
ticket instead of waiting for a taller neighbour. Composing or editing
opens the composer as a panel laid over the **left half** of the rail, the width
the middle column had; the rail beneath keeps its layout and is covered, never
reflowed. The editing pin that today sits atop the rail stays visible in the
uncovered right half.

Below the workspace, **Bills** (today's `MyShiftSurface`) and **Expenses** (today's
counter expenses list) remain visible together. Expenses sit on the left at the
menu's width; Bills sit on the right at the two-column rail's width. Both rows use
the same track widths and gap, including after resizing. Narrow screens scroll
sideways at these widths instead of stacking or squeezing either panel. Their
horizontal scroll positions stay linked. There is no tab switch. Each panel's
loading shape occupies the same column as its loaded content. The owner chose
the existing Cash/UPI tiles atop the Bills panel only. The final approval removes
the trial total from the header pill: that pill describes counter status, not
money. Search keeps its full menu-column width. The payment split sits
below the initial viewport and is reached with a short downward scroll.

The records row fills another viewport, less the persistent demo banner and outer
padding. Scrolling to the bottom leaves only Bills and Expenses on screen; neither
is capped at 28rem. Each panel scrolls its own long list. The menu scroller contains
its layout and paint, and the demo shell clips escaped overflow, so hidden menu
content cannot create empty document scroll space below records. Flex gaps exclude
closed dialogs from the outer spacing, preserving the panel's viewport alignment.


Below the width two columns need, the workspace still scrolls sideways rather
than rearranging. The single resize handle sits between the menu and the rail.

The finished-ticket flight (*Only a finished ticket travels*) lost its
destination; a finished card now fades where it stood while its space collapses,
and the Bills panel's totals update.

**Rejected**: keeping the middle column narrower (the owner rarely uses it, and
any width there is taken from the rail); the composer as a full-screen dialog
(hides the menu the biller is tapping); squeezing the rail to one column while
composing (every card would jump on every first tap).

### D2. The label is a nullable column on the order, cleared as the order leaves the rail

> **Relaunch:** labels live in `order_labels`, written by the `_v2` commands and
> cleared by `orders_label_leaves_the_rail` (R8). The `orders.label` column this
> decision added exists in production and is unused; the guard below is the first
> launch's, and the rollback restored the guard to its pre-#74 body.

`orders.label text`, trimmed, 1–24 characters or null, carried as an optional
`label` key by the create and revise order commands and the pay-now path's order
payload. It is not a customer field and does not touch `customer_*` or the
global customer identity: "the phone is the customer" stands.

A `BEFORE UPDATE` trigger on `orders` sets `label` to null whenever the row
becomes **off the rail** — cancelled, or paid with `prepared_at` set (by the
counter or the day change) — so every path that finishes an order clears it with
no path able to forget. The existing paid-row immutability guard learns that
`label` may change to null and to nothing else after payment. Rows written before
this change have no label.

At payment, the customer dialog's name field, when the looked-up number has no
saved name (or no customer), is pre-filled with the label; a saved name always
wins. This is client behaviour only; what is saved is what the biller confirms.

The label may hold a person's name, so it is treated as PII-adjacent: never
logged, never in analytics, exports or receipts, and absent from `bills`.

**Rejected**: a name without a phone in `customer_name` (breaks the
phone-identifies-the-customer rule and would leave unattached names in history);
keeping the label after payment (the owner wants it thrown away, and keeping less
is the privacy default); clearing it by a nightly sweep (an order would keep it
for hours after leaving the rail).

### D3. A note is a nullable column on the dish line

`order_items.note text`, trimmed, 1–60 characters or null, allowed only on
`kind = 'item'` lines (check constraint), carried as an optional `note` key on each
line of the create and revise commands. It is copied to no bill line and printed
on no receipt. It carries no amount, so bill arithmetic is unchanged.

In the composer, a pencil at the right of the line opens a sheet with a text box and chips. The chips start as a
fixed handful (*No sauce*, *Extra spicy*, *Less spicy*, *No onion*, *No mayo*) and
are replaced, most-used first, by the notes this tablet has saved — kept in the
tablet's local storage as a convenience, losing nothing if cleared. On a line of
two or more, the sheet asks **All** or **Only 1**; *Only 1* lowers the line by one
and adds a new line of one with the note.

The database keeps a locked line's note (D4): a revision that changes it is accepted
with the note unchanged, so a queued edit never becomes needs-attention work.

**Rejected**: an order-level note (the owner: a note belongs to the dish, and only
the kitchen making that dish needs it); manager-configured presets (a settings
screen for five words); priced modifiers (money; a separate change).

### D4. The composer's line key is the dish, its note and whether it is locked

Tapping a menu tile adds to the newest line of that item that has **no note and is
not locked**; with none, it adds a new line. + on a line raises that line unless
it is locked, in which case it adds a new line of one beside it. A **locked** line
is one the kitchen has marked Ready or the counter has ticked (D6). − always
works. A note can be changed only on an unlocked line. The menu tile's count
shows the item's total across its lines.

A new line takes the menu's **current** price, as every new line does today
(`revise_billing_order` checks new lines against the menu). A split or a locked
line's follow-on is a new line, so after a mid-order price change it carries the
new price. This is the existing rule applied, not a new one.

### D5. Ready is an append-only kitchen record; a dish's ready quantity is derived

> **Relaunch:** the functions are `kitchen_ready_v2` and `kitchen_ready_undo_v2`;
> `kitchen_ready_v2` also records an acknowledgement when the kitchen has none for
> the order's current version (R4). The table is the first launch's.

```
kitchen_readies
  id uuid pk                 -- client-generated, idempotent
  outlet_id, device_id, shift_id, person_id
  order_id uuid
  lines jsonb                -- [{ id, quantity }] as the kitchen saw them
  undoes uuid null           -- an Undo row points at the Ready it reverses
  at timestamptz default clock_timestamp()
```

`kitchen_ready(p_id, p_order_id, p_lines)` records the lines and quantities the
cook was shown. It is **not** refused for a stale version: what the kitchen saw is
what it made. A dish's **ready quantity** is the sum of its quantities over Ready
rows that no Undo row reverses, capped at the line's current quantity. So a
quantity lowered meanwhile is simply capped, and a quantity raised meanwhile
leaves the extra still owed — which arrives as the next ticket (D7).

`kitchen_ready_undo(p_id, p_ready_id)` appends an Undo row. Done remains
undoable whenever its ticket is visible, with no time window. Undo changes only
kitchen readiness, preserving any counter handover already recorded. Consequently
only food not handed over becomes owed again. A failed command preserves the
prior state and reports the error. Ready is sent on the first click.

Ready refuses a cancelled or finished order, a line that is not this tablet's to
see, and a tablet without a live kitchen shift. It is online-only, like ACK.

**Rejected**: a mutable `ready_quantity` column on `order_items` (a kitchen
writing to a bill-integrity table, and no history for prep times); refusing a
stale Ready like ACK (it would make the cook press Ready twice for food already
made, and a raised quantity is handled better by the next ticket).

### D6. A dish tick is a counter command over a per-dish record; Prepared is derived

> **Relaunch:** the command is `prepare_order_lines`, routed to
> `prepare_order_lines_v2` by its `variant` (R3), and `revise_billing_order_v2` does
> what this says of `revise_billing_order`. `prepare_billing_order` is the restored
> pre-#74 function and is not edited: a whole-order command sets the order's
> preparation only, and the on path reads a prepared order's dishes as ticked (R4).

```
order_line_preparations
  order_item_id uuid pk references order_items on delete cascade
  outlet_id, order_id
  quantity int               -- the line's quantity when it was ticked
  prepared_at timestamptz    -- the command's time
  shift_id, person_id
```

A new outbox command, `prepare_order_lines` (payload `{ orderId, lines: [{ id,
prepared }] }`), idempotent by command id and attributed like every counter
command, ticks or unticks dishes on the owning tablet's order. A tick records the
line's current quantity; a line is **ticked** while that recorded quantity is at
least its current quantity, so a quantity raised later (only possible on a line
ticked after the edit was queued — the composer locks ticked lines) shows the
extra unticked. An untick deletes the row. A line removed later takes its row
with it.

After applying the lines, the command sets the order's `prepared_at` to its own
time and `prepared_source` to `counter` when every item line is ticked, and clears
both when one is not and the order is open, with the existing rules intact: no
untick that would reprepare a finished (paid and prepared) order, and a tick
landing on an order the day change finished replaces the cutover with its earlier
time (#69). `revise_billing_order` clears an open order's counter-set
`prepared_at` when the revision leaves an item line unticked.

`prepare_billing_order` remains for commands already queued on tablets: prepared
true ticks every item line, false unticks every one. The day change still writes
only the order.

The order-level **Prepared** control is omitted: the item ticks state handover.
Its footer space carries Table N or Takeaway. Without a service, Paid spans the
available footer width. Service details leave the header, which holds number,
label and total. Under the label, small and muted, the card says how long ago the
order was placed (*21m ago*); the number and total are each as tall as the label
and that line together. The first launch's age ring there was removed on 14
October 2026: an order's age measured neither the kitchen, which hands food over
dish by dish and again as a table orders more, nor payment, which comes last, so a
ring counting on until payment alerted to nothing. A ring per dish until handover
was considered and refused as too much on the card. The kitchen keeps its ring. The
member badge sits on the order number. Customer entry remains in payment and edit.
The composer uses an accessible, visually hidden Order Label caption and an
Order Label placeholder, a compact quantity pill, a right-aligned pencil, and Save.

**Rejected**: ticks inside `order_items` (a counter tick is not part of the sale and
must not trip the bill-integrity guard on a paid order); the counter's tick setting
the kitchen's Ready (the counter would erase the kitchen's record of when it was
done); keeping the order-level control as a tap-to-tick-all (the owner: it reads as
information now).

### D7. A kitchen card is its ticket: food still owed, judged since this kitchen's last Ready

For each line a kitchen shows, **owed** = quantity − max(ready quantity, ticked
quantity). The kitchen card shows only owed food, with owed quantities. A cooking card with nothing owed leaves the active part of the board. Each
unreversed Ready retains a separate Done receipt until all its captured food is
handed over at the counter. Handover consumes older receipts before later ones.
Lowered or removed quantities cap those receipts. Unticking restores the gray
Done receipt; later food still arrives as its own active ticket.

The New / Edited / Cancelled comparison (#70, #72 D7) is made between today's
owed lines and the lines of this kitchen's latest acknowledgement **made after its
latest unreversed Ready** of the order; with no Ready, as today. Consequently:

- After Ready, any food newly owed is a **new ticket**: no acknowledgement since
  that Ready, so the card is **New**, numbered *#42 · n* where n is one more than
  this kitchen's unreversed Readies of the order.
- Food removed, or the order cancelled, after Ready leaves nothing owed and no
  acknowledgement since to compare with — no card, no Cancelled.
- Before Ready, everything is as today, compared on owed quantities, so a dish the
  counter ticks leaves the comparison silently.
- An Undo restores the earlier acknowledgements' standing: the card returns as it
  was before Ready, quiet if it had been acknowledged.

Two kitchens whose filters overlap share a dish's ready quantity: the first Ready
makes it ready for both.

Each carrying kitchen has its own fixed indicator slot: a gray single tick for
sent, an orange double tick for ACK, an orange bell for food that kitchen marked
Ready but the counter has not handed over, then an empty slot once all its food
is ticked. A kitchen's transition never replaces another kitchen's indicator.
If later food is still owed after a Ready receipt is handed over, its slot returns
to sent/ACK. Undo and counter unticking restore the corresponding earlier state.

### D8. The counter learns readiness through its kitchen read

> **Relaunch:** `counter_kitchen_marks_v2`, read by the on path in place of the old
> one (R5). The ticked state comes with the on path's order read, and labels with
> it (R8).

`counter_kitchen_marks()` gains, per open order, the ready quantity of each of its
item lines (line id → quantity), plus a per-kitchen aggregate `dishStates` array
in the existing kitchen order: sent, acknowledged, ready or handed_over, with null
for a kitchen not carrying that order. No dish-to-kitchen mapping, person or time. The
counter already reads its own order lines. A line shows its Ready checkbox cue while its ready quantity
exceeds its ticked quantity. Ready reaches the counter by the kitchen pulse the
bell already uses.

The ticked state is read with the rail's own order read (the counter shift selects
its outlet's `order_line_preparations` rows under RLS, as it selects
`order_items`), so a tick queued offline shows at once from the outbox's optimistic
state.

### D9. Ready is a third checkbox state

> **Relaunch:** the Ready *cue* below — the pulsing dot in an orange-outlined
> checkbox, silent — is superseded by the owner's 12 October approval: whole-row
> fill, shine, two handbell rings and the bell's swing (R6). Everything else here
> stands: ticked text and checkbox, geometry, the age ring and its tones, the
> kitchen slots, and the kitchen's Done.

Ready uses a localized checkbox cue while item names and notes stay still.
The demo offers three candidates: A, a soft orange halo around the orange-outlined
checkbox; B, one orange light that starts circular, expands to fill the rounded
checkbox, and fades away;
C, the same steady dot without animation. The owner chose B, now the default.
The shade stays uniform without a fixed bright center; the orange checkbox border
stays visible throughout the fade. The light only expands and fades to nothing, pauses briefly, then
restarts as a dot; it never visibly shrinks. Animated cues share one
2.4-second clock on the pipeline, including newly arriving
ready lines, so they pulse together. Reduced motion keeps the cues steady.
Ready adds no outline around the quantity or item and does not change their text
colour. Only the Ready checkbox's outline becomes orange, retaining an indicator
when the pulse is invisible. An empty gray box means waiting, the cue
means kitchen-ready, and the orange checked box means handed over.
A tick colours the dish text orange and fills only its checkbox, removing the
heavy filled-row treatment. The 15px dish checkbox is smaller than Prepared's
17px box, stays fixed when notes or wrapping make a line taller, and the quantity
is always separate and visible. Rows have a 6px gap and vertically centered
contents. Clickable rows have a hand cursor and subtle shadow on mouse hover;
touch appearance stays the same. The kitchen status sits midway between the compact age ring and action icon.
Sent/ACK marks are 18px with a slightly heavier stroke: a neutral single tick means
sent, and an orange double tick matching Prepared means acknowledged. The compact
counter timer uses total minutes even above 60 within its existing footprint. SVG
text is centered on the ring's center; its full age remains accessible. Ages turn
warning at 10, red at 20, and a darker, contrast-validated red at 40 minutes.
The gold badge overlays the order number without occupying headline width, and
Table/Takeaway is centered in the space beside Paid.
A 0.25rem left inset comes from the existing 0.375rem gap beside
the checkbox, leaving 0.125rem there; row width and quantity/text geometry stay the same.
There is no per-card *n ready* mark; the rail's existing scroll
pointer gains *Ready #n* while a ready order is out of view. Under reduced motion
the checkbox cue stays steady. No sound. Tokens for the checkbox and ticked text are
semantic, contrast-validated in both themes.

The owner chose Done beside the timer. Unchecked, it has a thicker gray border,
a light gray interior and a gray tick, inside a timer-sized touch target.
Checked and unchecked circles have the same outer diameter as the timer, with a
fixed 21-unit radius and 5-unit stroke in the shared 56-unit view box.
Checking sends Ready immediately, fills the circle green, and collapses the
muted gray ticket to its header. An expand arrow replaces the timer. Clicking
anywhere on the Done receipt toggles expansion both ways, except its explicit
Done/Undo control; the arrow is also keyboard-accessible. Undo Done remains available with no countdown.
Kitchen labels are omitted: the order number identifies the food.
Only counter handover removes a Done ticket: it fades and shrinks by 4% over
320ms in its original slot, then holds a blank slot for 180ms before packing
again; reduced motion uses only the fade. The kitchen board packs into the
shortest of N responsive columns, without matching a neighbour's height.

### D10. The demo is built and approved first; nothing merges before the live half

> **Relaunch:** superseded by the gates. Everything merges and ships off; the owner
> turns it on (R9). The 11 October approval below still stands as the approval of
> the screens.

The counter is live in production and has no gate to hide a half-built screen
behind. Phase 1 builds every screen against the demo adapter on this change's
branch; the owner approves from screenshots and the branch's `/demo` preview. The
branch merges only when the live half is complete and verified. Within the
branch, the demo adapter's types are the contract the live adapter must meet.

The owner approved Phase 1 on 11 October 2026: "rest looks good," requested that
the header total be dropped, and explicitly asked to record confirmation and
commit. Task 1.9 is complete. The database/live half is authorized by that gate,
but the owner will continue it in a separate chat; this session stops after the
demo commit. The handoff it names is carried into *The approved UI contract*
above.

### D11. Durable feedback precedes background reconciliation

> **Relaunch:** the first paragraph stands. The second — ten- and five-second
> fallbacks — is what R5 removes; reads follow writes, the pulse and the
> foreground only.

Dish ticks update the rail from the adapter's locally persisted result and release
their order immediately after local acceptance. They do not await pipeline or
shift-history reads. Pending projections serialize per order; other orders remain
usable. Invalidating an older pipeline read prevents it restoring a pre-tick view.
Payment and other accepted rail actions also release their controls before
background reconciliation; payment projects the accepted paid order immediately.

Live label validation reuses the rail's orders. Pipeline and bill fallbacks run
every ten seconds while visible; kitchen marks have a five-second fallback plus
Realtime and foreground nudges. Each reader runs one request at a time and retains
one trailing read when another nudge arrives. Post-Done callers await that trailing
read. Each caller resolves after its own batch, so subsequent polling cannot keep
an earlier action waiting indefinitely. Responses from a superseded outlet, shift
or adapter cannot update the UI.
No command, outbox, migration, policy or money contract changes.

## Data Protection, RLS and Isolation

- `kitchen_readies`: RLS on; select for the writing kitchen shift's own outlet and
  managers of it (as `kitchen_acknowledgements`); no direct insert, update or
  delete for any client role; append-only trigger. Isolation test.
- `order_line_preparations`: RLS on; select for a live counter shift at its own
  outlet and managers of it; no kitchen select (it reads through the board); no
  direct write for any client role. Isolation test.
- `order_labels` (R8): RLS on; select for a live counter shift at its own outlet
  and managers of it; no kitchen select; no direct write for any client role.
  Isolation test.
- `order_items.note`: covered by the existing order policies; the kitchen's read
  gains notes only through `kitchen_board_v2()`, which returns no label, customer
  column, price or payment fact.
- The three isolation tests were written for the first launch and deleted by the
  rollback; they return with this change, and `order_labels` gets its own.

## Offline Semantics

- Label and notes ride the existing order commands, which carry `variant:
  'dishes'` on the on path (R3); queued offline, idempotent, unchanged in kind.
- Dish ticks are an idempotent command in the outbox, drained in order with the
  rest; a tick for a line removed meanwhile is accepted and changes nothing.
- Ready and Undo are kitchen actions and online-only, like ACK. The counter fills a
  dish only from a read it has made; offline it shows the last readiness it read,
  and rings only for a Ready it reads arriving (R6).

## Money

No amount is added, removed or computed. A note carries none. A split line is an
ordinary new line at the menu's current price (D4).

## Risks

Phase 1 approval (11 October 2026): the owner chose Cash/UPI in Bills only,
removed the trial header total, and chose D9's pulsating dot. The existing demo menu's
Main Course category supplies Kitchen 2. Proposed dish records live in a typed
mock sidecar until the database phase, keeping current schema-generated fixtures
valid. Counter snapshots own labels, notes and ticks; kitchen snapshots own Ready
and ACK. Ready records merge by command ID with Undo preserved, so delayed demo
snapshots cannot erase another tab's Ready. See `review.md` and `review/`.

- **A card in two columns is narrower** than today's rail card at the same
  viewport; the demo checks a four-dish order with notes still reads at the
  counter's tablet width, and the one-dish height rule is re-measured.
- **Overlapping kitchen filters** share readiness (D7); the outlets run disjoint
  filters today.

Relaunch risks:

| Risk | Mitigation |
|---|---|
| The on path's reads cost more than the old ones on the smallest compute | `counter_kitchen_marks_v2` and `kitchen_board_v2` are written set-based and timed against the old functions on the same seeded rail (tasks); the request budget runs with both gates on; the gate's page shows each tablet's requests and slowest read on the day it is turned on. |
| The handbell is not the sound the owner heard | Its numbers are the audition's own code, recovered from the session that made it; the owner hears it on staging before anything is promoted. |
| Notes vanish from the kitchen while DT is off | Said in the proposal's Change gate section and in the release workflow's turn-off message: say them aloud. |
| A tablet holds a 12 October `prepare_order_lines` without a variant | It reaches the 12 October function, which still exists, as it would today. |
