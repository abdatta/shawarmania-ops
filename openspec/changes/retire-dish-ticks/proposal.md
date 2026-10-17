# Proposal: retire-dish-ticks

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-15 when
> `each-dish-is-ticked-off` (#74) was archived, with `retire-kitchen-ready`
> beside it and `retire-instant-saves` a day later. Expanded on 2026-10-17 into
> one change retiring all three, because their on-branches are entangled
> (owner, 2026-10-16): `instant-saves` depended on `dish-ticks` and
> `kitchen-ready`, and `kitchen-ready` on `dish-ticks`.

## Why

The three gates have done their job.

- `dish-ticks` (*DT*, `retireBy` 2026-12-15) and `kitchen-ready` (*KR*,
  2026-12-15) were turned on in production on 14 October 2026, pulled once on
  15 October (off with each other at 09:23 IST, on again at 11:47) and ran
  through the services of 15 and 16 October.
- `instant-saves` (*IS*, 2027-01-15) was turned on at 08:44 IST on 15 October,
  pulled once with them (off 09:23, on 11:48), ran through the same two
  services, and the owner tried it on *Cafe Staging* with the network throttled.

The owner asked for one more clean business day before retiring them. On
17 October production read: all three on since 11:47–11:48 on 15 October with
no turn since; 124 bills settled at Kalyani Cafe on 16 October against 64 on
15 October; no server error from either tablet through the service; both
tablets on build `f0b4c7c` with every gate booted on. The owner confirmed the
day went fine.

The off paths are now dead code with a switch on them: `dish-ticks`' off path is
the whole counter and kitchen as they were before #74. Every live gate doubles
what the suites must run.

## What changes

The `retire-gate` workflow, for three gates at once, children first where order
matters.

- **Code.** Every toggle point keeps its on branch:
  - the counter is the menu and a two-column rail with the composer laid over
    it, and Bills and Expenses sit in the records row below (`BillingCounter`,
    `CounterShell`, `CounterActivity`, `CounterActivityRail`, `MenuGrid`,
    `BillComposerFooter`);
  - the rail is `DishOpenOrdersSurface`, which fills a Ready dish and rings the
    handbell (`PipelineCard`, `ReadyDish`, `useReadyRinger`);
  - the counter reads its kitchens through `counter_kitchen_marks_v2` only
    (`KitchenMarksProvider`);
  - the kitchen runs `DishKitchenBoardScreen`, with Done on every card;
  - the owner's Orders tab draws `DishOpenOrderSummary` and reads its orders
    when the tab is chosen (`ManagerBillingHistory`);
  - phones read `+91` on the checkout and the bill detail;
  - the till's own saves draw at once (`instant-saves`' own-save keys, the
    peeks, the table picker, Bills' messages).
- **The off path goes where nothing else uses it.** The old kitchen screen, card
  and board hook (`KitchenBoardScreen`, `KitchenCard`, `useKitchenBoard`), the
  old marks provider, the three-column layout and its dock animation, and the
  kitchen adapter's `readBoard`, `readCounterMarks` and `acknowledge`. The live
  billing adapter always reads labels and ticks and always queues order
  commands with `variant: 'dishes'`. `OpenOrdersSurface` and `PipelineCard`'s
  plain card stay: the standalone Open orders page still draws them.
- **What stays on purpose.** The outbox still delivers a command queued without
  a variant to the function it was written for, so a tablet that queued one on
  an older build and updates before delivering it strands nothing. The billing
  history still lists `listManagerOpenOrders` for its Orders tab.
- **Gates.** The three keys move from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`;
  *DT*, *KR* and *IS* are free for new gates. The demo's copy loses their words
  and history.
- **Tests.** Every `@cg-off:` and `@cg-round-trip:` test of the three goes, and
  so does every unit test that ran the old counter or kitchen with no gate
  snapshot where an on-path twin exists. `describeChangeGate` blocks become
  plain tests of the on behaviour. The demo's dependency tests go with the only
  gates that depended on another; the database tests still prove the cascade.
- **Spec and docs.** `counter-billing`'s requirements that named a gate lose the
  gate sentence and the gate-off scenario. `docs/` stops calling the behaviour
  gated.
- **Database, a week after every tablet runs the retirement build.** Three
  contract migrations, children first: `instant-saves`, then `kitchen-ready`,
  then `dish-ticks`. Each sets its gate's `retired_at`; `dish-ticks`' also drops
  what only the off path used, including the pre-#74 functions restored by
  `20261017000000_restore_counter_before_dish_ticks`, once nothing calls them.

## Change gate

No gate: a retirement keeps the behaviour already on.
