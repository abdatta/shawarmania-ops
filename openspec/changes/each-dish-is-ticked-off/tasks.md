# Tasks

## 0. Before you start

Read design → *Read this first* and *Relaunch under #75* (R1–R11) before anything
else. The first launch's tasks were ticked on 12 October and unticked by the
rollback; these replace them. The first launch's code is at `9e916642` and is the
reference for every screen, but it is ported onto the on path, never restored over
the off path. Push only to `stage`, and only with the owner's go-ahead.

## 1. The owner sees it first

- [x] 1.1 The screens: the owner approved the counter's layout, the label, the dish
  ticks, the notes, the kitchen's Done and the Ready checkbox cue from demo
  screenshots on 11 October 2026 (D10, `review.md`, `review/`).
- [x] 1.2 The Ready signal: the owner chose Handbell option 3, two rings, the bell's
  swing and the filled, shining dish row on 12 October 2026, superseding the cue;
  on 14 October shortened the sound to a four-strike figure played twice (3 s) with
  the swing three times as long, kept the checkbox gray on the fill, made a tick stop the ring and an untick
  ring nothing (proposal; design R6).
- [x] 1.3 The demo runs both gates, on by default: every screen of the 11 October
  demo works on the on path with R6's Ready signal, and the demo's Change gates page
  turns either gate off and the screens follow at once (#75 D15).

## 2. The gates and where the code forks

- [x] 2.1 Declare `dish-ticks` (*DT*) and `kitchen-ready` (*KR*, depending on
  `dish-ticks`) in `src/change-gates/gates.ts`, `roundTrip: 'tested'`, with their
  rows and the dependency row inserted off by this change's migration in the
  proposal's words. The demo's two example entries become these declarations.
  `npm run lint:change-gates` passes.
- [x] 2.2 The toggle points (design R7): `counter-shell.tsx` and the kitchen's root
  choose the on path's screens from `useChangeGate('dish-ticks')`; a component #74
  rewrote is forked beside the old, and one it only added to branches with the off
  branch verbatim; `kitchen-ready` is read inside the on path. The live
  billing and kitchen adapters take the page's boot answer; the mock adapters ask
  the demo's current answers.
- [x] 2.3 A command's variant (design R3): the optional `variant: 'dishes'` envelope
  field, set only by the on path; the RPC chosen from type and variant; the outbox
  still imports no gate; an off-path envelope is byte-for-byte today's. Unit tests.

## 3. Database

One migration, dated after the newest, declaring `-- change-gate: dish-ticks`.
`npm run lint:migrations` after every edit.

- [x] 3.1 `order_labels` (design R8) with RLS — a live counter shift at its outlet,
  Franchise Admin, owner; no kitchen; no client write — and
  `orders_label_leaves_the_rail`, `after update` on `orders`, inert unless
  `dish-ticks` is on.
- [x] 3.2 `create_billing_order_v2` and `revise_billing_order_v2`: the old bodies
  plus the label (to `order_labels`; a blank one deletes it), notes (a locked line
  keeps its note), and on revision the order's counter-set preparation cleared when
  an item line is left unticked. Create also deletes the outlet's labels of orders
  already off the rail (R4). Commands queued without the keys stay valid.
- [x] 3.3 `prepare_order_lines_v2`: D6, plus R4 — a prepared order's untouched item
  lines read ticked, and are written as ticks before any untick.
- [x] 3.4 `kitchen_ready_v2` and `kitchen_ready_undo_v2` (D5), Ready also
  recording an acknowledgement of the current version when the kitchen has none
  (R4); each bumps the outlet's pulse.
- [x] 3.5 Reads: `kitchen_board_v2` (D7: notes, owed food, Done receipts, ticket
  numbers, judged since this kitchen's latest Ready; no label) and
  `counter_kitchen_marks_v2` (D8: ready quantities per line and each kitchen's
  sent / acknowledged / ready / handed-over slot); `kitchen_acknowledge_v2`
  recording full visible lines with notes (R4).
- [x] 3.6 Time `counter_kitchen_marks_v2` and `kitchen_board_v2` against the old
  functions on the same seeded rail of eight open orders and two kitchens; record
  both in the design (R5). The counter's read costs the same as the old; the
  kitchen's about a millisecond more.
- [x] 3.7 Regenerate `database.types.ts` and check its diff.
- [x] 3.8 pgTAP: the label's lifecycle on every finishing path (counter tick,
  payment of a prepared order, day change, cancellation), with the gate off and on,
  and its absence from bills; notes and their refusals; ticks deriving and clearing
  preparation; a whole-order command and the day change read as all ticked, and an
  untick after one; Ready, a stale Ready capping and leaving extra owed, Undo; Ready
  answering for ACK on the old board; a ticket after Ready; silence after a removal
  or cancellation following Ready; two kitchens; the board omitting label and
  customer; a full ACK snapshot read the same by both boards.
- [x] 3.9 **Isolation**: for each of `order_labels`, `order_line_preparations` and
  `kitchen_readies`, a counter shift, a kitchen shift and a Franchise Admin of one
  outlet each hand-craft a select of the other outlet's rows and receive nothing;
  every client role's direct insert, update and delete is refused; a kitchen's Ready
  naming another outlet's order is refused.

## 4. The on path

- [x] 4.1 Adapters, live and mock: labels and notes on order commands, the dish-tick
  command with its optimistic state, the order read embedding labels and ticks, the
  kitchen's v2 board, Ready, Undo and ACK, the counter's v2 marks.
- [x] 4.2 The counter (design D1, D4, D6, D9, *The approved UI contract*): the
  workspace, composer and note sheet, the rail card and its slots, the records
  panels, shimmers reshaped with them; on-path domain helpers in
  `src/domain/dish-workflow.ts`, no shared helper edited.
- [x] 4.3 Ready on the counter (design R6): `--dish-ready` / `--on-dish-ready` tokens in both
  themes, the fill and shine, the handbell and its burst queue, the bell's swing,
  the first read silent, a tick settling it and an untick silent, reduced motion;
  *↓ Ready #N*.
- [x] 4.4 The kitchen (D7, D9): notes, owed food, Done with receipts and Undo,
  tickets after Ready, masonry, the trailing re-read (R5); Done only while
  `kitchen-ready` is on.
- [x] 4.5 No read on a timer (R5): the on path adds no timer that reads the
  network — the kitchen keeps today's twenty-second visible re-read, single-flight —
  proved by the request budget with the gates on (counter idle 3 a minute against
  2 off, kitchen idle 9 against 8), and no demo-only component is reachable from
  the live tree.

- [x] 4.6 The owner's Orders tab (design R11): `manager_kitchen_marks_v2` with its
  `ackedLines`, owner and franchise admins only; the compact card with the four dish
  states and the kitchens in words, behind `dish-ticks`, read on open only; pgTAP
  89, the REST probe, unit tests in both states, the old browser test tagged
  `@cg-off:dish-ticks`.

## 5. Tests in both states

- [x] 5.1 Unit and component tests with `describeChangeGate('dish-ticks', …)` and
  `describeChangeGate('kitchen-ready', …)` at each toggle point; the on path's
  domain (line key, locks, *Only 1*, owed food, ticket numbers, Prepared following
  the dishes, the name suggestion, the note ranking, the ringer's burst queue and
  first-read silence).
- [x] 5.2 Existing browser tests the on path contradicts are tagged
  `@cg-off:dish-ticks` (or `kitchen-ready`) and receive no other edit.
- [x] 5.3 Demo browser tests, `@cg-on`: the walkthrough's label, note, tick, Done,
  Ready fill, ticket *#N · 2* and the records panels, in two tabs.
- [x] 5.4 Auth browser tests, `@cg-on`, a counter and a kitchen against the local
  stack: a labelled order with a noted dish reaches the kitchen; Done fills the
  counter's dish; ticking it clears the fill and finishes a paid order; food added
  after Ready arrives as *#N · 2*; food removed after Ready rings nothing; Undo
  restores the card; offline ticks settle exactly once.
- [x] 5.5 Round trips: `@cg-round-trip:dish-ticks` and
  `@cg-round-trip:kitchen-ready` — new work on, part of it queued offline; that gate
  alone turned off (and KR with DT); reload; the order finished on the old path —
  paid, prepared, cancelled — settling exactly once, the kitchen quiet.
- [x] 5.6 The request budget gains one dish tick; it holds in both states; the
  readings and date are recorded in the test.

## 6. Docs

- [x] 6.1 Update `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/OFFLINE_AND_SYNC.md`,
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`,
  `docs/DESIGN_SYSTEM.md`, `docs/DEMO_MODE.md`, `docs/GLOSSARY.md`,
  `docs/TESTING.md` and `docs/RELEASES.md`, each saying what holds with the gates
  off and what with them on.

## 7. Verify and stage

- [x] 7.1 Run every gate `verify.yml` runs: lint, format, typecheck, Edge
  typecheck, unit, contrast, build, pgTAP, RLS and generated types on a fresh local
  stack; the demo and auth suites off and on in the Staging run (AGENTS.md,
  Verification), all green on 14 October 2026.
- [ ] 7.2 Walk the built counter and kitchen with both gates off and on, phone and
  tablet widths, light and dark, console and network clean; write
  `verification.md`.
- [x] 7.3 Land the change as three to five commits; with the owner's go-ahead, push
  `HEAD:stage`, fast-forward only; Staging green.
- [x] 7.4 `npm run test:e2e:staging` against the published staging site.
- [ ] 7.5 **Owner:** on *Cafe Staging*, turn `dish-ticks` on, then `kitchen-ready`;
  run a service with the laptop as the counter and the phone as the kitchen; hear
  the handbell; turn each off and on once.

## 8. Release

- [ ] 8.1 **Owner:** Promote in the deploy window; it ships with both gates off.
- [ ] 8.2 `/release dish-ticks` at a quiet hour; watch each tablet on the gate's
  page through the next service; pull it once, off and on.
- [ ] 8.3 `/release kitchen-ready` the same way.
- [ ] 8.4 Real use; then archive, which refuses until the history shows each pull.

## 9. Phase gate

- [ ] 9.1 **PHASE GATE.** Roadmap #74's checkpoint — the owner approved the
  counter's new layout, the label, the dish ticks and the notes from demo
  screenshots, and the Ready fill and handbell from an audition, before any of it
  was relaunched; the counter is the menu and a two-column order rail, with the
  composer laid over the rail's left half and Bills this shift and Expenses in
  side-by-side panels below; an order taken with only a label shows that label as
  its card's headline on the counter, offers it as the name when a new number is
  entered at payment, and keeps it nowhere once the order leaves the rail; a dish
  carries a short note from the composer that only the kitchen showing that dish
  sees, and the counter's card; every dish on a rail card is ticked off on its own
  and the order's **Prepared** follows the dishes, unticking itself when an edit
  adds food; a kitchen marks its part of a ticket **Done**, the card collapses
  until counter handover, and on the counter those dishes fill orange and shine
  while the order's bell swings to two rings of the handbell, until ticked; food
  added after Ready reaches the kitchen as a new ticket, and food removed or
  cancelled after Ready reaches it not at all; a ticked or Ready dish takes no more
  and its note is fixed; each outlet's dish records and labels are isolated, proved
  by a hand-crafted request; all of it ships behind the `dish-ticks` and
  `kitchen-ready` change gates, off, and each gate's Off is proved to be the counter
  and kitchen as they were, with nothing it saved stranded; the counter and kitchen
  stay inside #75's request budget with both gates on; and the four-role demo
  walkthrough still walks, with a kitchen tab's Ready filling a counter tab's dish.
