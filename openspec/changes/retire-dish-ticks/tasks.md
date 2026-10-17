# Tasks: retire-dish-ticks

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`) for
`instant-saves`, `kitchen-ready` and `dish-ticks` together. No gate of its own
and no migration until section 3.

## 0. Preconditions

- [x] 0.1 Each change is archived: `each-dish-is-ticked-off` (`dish-ticks`,
  `kitchen-ready`) and `the-counter-shows-what-it-saved` (`instant-saves`).
- [x] 0.2 Each gate is on in production and has stayed on since its pull.
  *(Read from `change_gate_events`, read-only, at about 05:15 IST on 17 October:
  `dish-ticks` on 14 Oct 16:40, off 15 Oct 09:23, on 11:47:09; `kitchen-ready` on
  14 Oct 16:41, off 09:23, on 11:47:47; `instant-saves` on 15 Oct 08:44, off
  09:23, on 11:48:15; nothing since.)*
- [x] 0.3 One more clean business day, as the owner asked: 16 October at Kalyani
  Cafe, 124 bills settled and 6 cancellations; no 5xx from either tablet between
  13:00 IST and 02:30 on 17 October; one stall at 14:07:44 IST put fourteen
  counter requests at 5–17 s, every one answered 200; both tablets on `f0b4c7c`
  with every gate booted. The owner confirmed the day on 17 October.
- [x] 0.4 Every gate depending on these is retired in this same change: `instant-saves`
  depended on both, `kitchen-ready` on `dish-ticks`, and nothing else on any.

## 1. The retirement change — code only

- [x] 1.1 Every toggle point keeps its on branch: `BillingCounter`, `CounterShell`,
  `CheckoutDialog`, `ManagerBillDetail`, `ManagerBillingHistory`,
  `MyShiftSurface`, `DishOpenOrdersSurface`, `DishOpenOrderSummary`,
  `KitchenMarksProvider`, `KitchenScreen`, `DishKitchenBoardScreen`, the mock and
  live billing adapters and the demo's orders mirror. Conditions that also
  checked `dish-ticks` or `kitchen-ready` are unconditional.
- [x] 1.2 The off path goes where nothing else uses it: the old kitchen screen,
  card and board hook, the old marks provider, the three-column layout and its
  dock animation, the kitchen adapter's `readBoard`, `readCounterMarks` and
  `acknowledge`, and the props that only chose between the two counters
  (`twoColumns`, `shortSave`, `dishReview`, `readyOn`). `OpenOrdersSurface` and
  the plain `PipelineCard` stay for the standalone Open orders page; the outbox
  keeps delivering a command queued without a variant.
- [x] 1.3 The three keys move from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and
  out of the demo's gate words and history.
- [x] 1.4 Tests: the `@cg-off:` and `@cg-round-trip:` browser tests go, with
  `e2e/kitchen-filter.spec.ts`, `e2e-auth/kitchen-tablet.spec.ts` and
  `e2e-auth/billing-two-tablets.spec.ts`, which held nothing else; `@cg-on:` tags
  are dropped. `dish-ticks.spec.ts` takes the old kitchen spec's place in the
  third auth shard. The unit tests' `describeChangeGate` blocks become plain
  tests of the on behaviour, and the old-counter twins of
  `billing-counter-dish.test.tsx` and `mock/dish-kitchen.test.ts` go.
- [x] 1.5 The `counter-billing` delta, and `docs/` no longer calls the behaviour
  gated.
- [ ] 1.6 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run build`; the browser suites on Staging.
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gates'
  rows are left alone and keep reading on, so a tablet on an older build keeps
  the behaviour it has.

## 2. Wait for every tablet

- [ ] 2.1 Every tablet's build, on the Change gates page, is the retirement build or
  later, continuously for a week. Record the date it was first true and the
  evidence.

## 3. The contract migrations, children first

- [ ] 3.1 `-- release: contract instant-saves`: sets the gate's `retired_at` and
  turns it off. Nothing else in the schema belongs to this gate.
- [ ] 3.2 `-- release: contract kitchen-ready`: sets the gate's `retired_at` and
  turns it off.
- [ ] 3.3 `-- release: contract dish-ticks`: sets the gate's `retired_at`, turns it
  off, and drops what only the off path used — the pre-#74 functions restored by
  `20261017000000_restore_counter_before_dish_ticks`, `kitchen_board`,
  `counter_kitchen_marks` and `kitchen_acknowledge` — once no tablet's build
  calls them and no queued command can name them. Keep every `_v2` name.
- [ ] 3.4 The pgTAP tests that named what was dropped; every database gate on a
  fresh reset; release it.

## 4. Archive

- [ ] 4.1 Report what was retired and when, then archive.
