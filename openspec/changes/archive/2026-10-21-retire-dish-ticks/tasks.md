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
- [x] 1.6 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run build`; the browser suites on Staging.
  *(Green on `stage` as `aabc97b7`, and in Deploy `ac4ce56d`'s full suite on 18
  October.)*
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gates'
  rows are left alone and keep reading on, so a tablet on an older build keeps
  the behaviour it has.
  *(Promoted: first live in Deploy `ac4ce56d`, 05:00 UTC on 18 October.)*

## 2. Wait for every tablet

- [x] 2.1 Every tablet's build, on the Change gates page, is the retirement build or
  later, continuously for a week. Record the date it was first true and the
  evidence.
  *(The owner set the wait to three services on 18 October, in place of a week.
  Read-only on 21 October: the registered devices are Kalyani Counter 2 and Shawarma
  Kitchen, both reporting `0b06e73`, which contains `aabc97b7`, both outboxes All
  sent. Cafe Laptop, registered but silent since 13 October and never reporting a
  build, was removed from Tablets at the owner's request the same morning. Kalyani
  Cafe traded 18, 19 and 20 October on it (138, 126 and 125 bills). The owner
  reloaded the app on their phone.)*

## 3. The contract migrations, children first

- [x] 3.1 `-- release: contract instant-saves`: sets the gate's `retired_at` and
  turns it off. Nothing else in the schema belongs to this gate.
  *(`20261031010000_contract_instant_saves.sql`.)*
- [x] 3.2 `-- release: contract kitchen-ready`: sets the gate's `retired_at` and
  turns it off.
  *(`20261031020000_contract_kitchen_ready.sql`.)*
- [x] 3.3 `-- release: contract dish-ticks`: sets the gate's `retired_at`, turns it
  off, and drops what only the off path used — the pre-#74 functions restored by
  `20261017000000_restore_counter_before_dish_ticks`, `kitchen_board`,
  `counter_kitchen_marks` and `kitchen_acknowledge` — once no tablet's build
  calls them and no queued command can name them. Keep every `_v2` name.
  *(`20261031030000_contract_dish_ticks.sql`. Production had two readers of the key,
  `order_label_leaves_the_rail()` and `order_line_added_by_an_edit()`; both keep
  only their on branch. Dropped: `create_billing_order`, `revise_billing_order`,
  `kitchen_board`, `counter_kitchen_marks`, `kitchen_acknowledge` and
  `kitchen_same_lines`, none called by any function kept. Kept, because a kept
  function still calls them: `prepare_order_lines` (`prepare_order_lines_v2`
  delivers through it) and `kitchen_visible_lines` (`kitchen_ticket`).
  `pay_billing_now`, `prepare_billing_order` and `billing_order_guard` were restored
  too but have no `_v2`: they are the live path.
  `scripts/rollback74-production.mjs`, which re-applied the restore, goes with
  them.)*
- [x] 3.4 The pgTAP tests that named what was dropped; every database gate on a
  fresh reset; release it.
  *(pgTAP calls to the dropped functions now call their `_v2`s, so the kitchen's
  refusals in 81 and 84 still run against the live functions; 88 loses its old-board
  and gate-off cases, 89 and 90 their gate turns, and 91, which only tested the
  `instant-saves` declaration, is deleted. The billing-race REST test sends the
  `dishes` variant through `billingCommandRpc`, as the app does. On a fresh reset,
  21 October: `test:db` 96 files green; billing races, dish ticks, change gates,
  drawer writes, counter telemetry and ledger timing green; `db:types` drops exactly
  the six. The Edge Function cases of `test:rls` answered 503 locally, from a shared
  Edge container another worktree had started and then removed; they run on the
  `stage` push.)*

## 4. Archive

- [x] 4.1 Report what was retired and when, then archive.
  *(Archived 21 October. The four contract migrations ran in production at 11:56 IST
  (Deploy of `da900d55`), setting `retired_at` on all four rows. Both registered
  devices, Kalyani Counter 2 and Shawarma Kitchen, were reporting `167bd0f1`, which
  contains it, by the evening.)*
