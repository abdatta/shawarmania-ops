## 0. Before Anything

- [x] 0.1 Read `design.md` end to end, and `the-kitchen-sees-its-orders/design.md` D7–D8 for the kitchen's own rules this change mirrors.
- [x] 0.2 Measure today's rail card heights in the demo (one dish, two dishes) before touching the card, and record them here. *(2026-10-09, demo biller at 1280×800: a one-dish card 98.25px tall and 285px wide; a two-dish card adds one 17.5px line.)*
- [x] 0.3 Reset the local database before trusting any DB gate; the container is shared.

## 1. The Database

- [x] 1.1 pgTAP (`84_the_counter_sees_the_kitchen.sql`): `counter_kitchen_marks()` refuses a kitchen shift, a person's session, a manager and a counter with no live shift; returns empty with no live kitchen; lists live kitchens by label, case-insensitively, and drops one whose shift ended; marks a new order `waiting`, an acknowledged one `seen`, an edit to visible dishes `waiting`, an edit to only another kitchen's dishes leaves that answer standing; an edit removing every dish of a kitchen leaves it `waiting` until its cancel ACK, then `null`; a Prepared order is `seen`; returns no key beyond D1's; `kitchen_same_lines` on the pairs the domain test pins. *(52 assertions. Written alongside the migration rather than strictly before it, so not first seen failing.)*
- [x] 1.2 Migration `20261014000000_the_counter_sees_the_kitchen.sql`: `kitchen_same_lines(jsonb, jsonb)` and `counter_kitchen_marks()` per D1, including the Prepared rule.
- [x] 1.3 Pulse per D2, as triggers on the rows themselves rather than edits to the functions: after insert on `kitchen_acknowledgements`; after a kitchen tablet's filter columns change; after a kitchen shift is inserted or its `ended_at` set. pgTAP: each bumps.
- [x] 1.4 `kitchen_pulses_select` admits a live counter shift at the outlet. **Isolation test**: a counter reads its own outlet's row and not the other outlet's; a counter with no live shift reads none.
- [x] 1.5 `npm run db:types`; the diff is the two functions, no stray telemetry.

## 2. Data Access

- [x] 2.1 Types in `adapters.ts`: `KitchenMarks`, with `KitchenAnswer` from the domain. *(The read is `KitchenAdapter.readCounterMarks()` rather than a billing method, and the counter reuses `KitchenAdapter.subscribe` for the pulse rather than a new counter channel: the kitchen adapter already holds both the pulse channel and, in the demo, the kitchen's state.)*
- [x] 2.2 Supabase adapter: the RPC, its rows keyed by order id.
- [x] 2.3 Mock adapter: the marks from `DemoKitchen` by the same rules, with *Kitchen 1* on shift; the pulse is the mock kitchen's one-second signature poll, now including acknowledgements and filter. `mock/kitchen.test.ts`: waiting, answered, re-armed by an edit, Prepared, not carried.
- [x] 2.4 The demo mirror carries the demo kitchen's acknowledgements and filter beside the orders, epoch rules unchanged; a message from a tab on an older build without them is adopted for its orders only.

## 3. The Card

- [x] 3.1 `kitchenBell()` in `src/domain/kitchen.ts`: ringing when any answer waits; dots whenever it rings, one kitchen included; the accessible sentence. Unit tests for every case in the spec delta, and `sameLines` against the pairs pinned in 1.1.
- [x] 3.2 `rail-ticket` utility (the torn edge on a `::before` layer, so the ⋮ menu is not cut off; an open menu lifts its card with `z-30`), the display-face number, dish-count tiles. Height measured: 98.25px, unchanged against 0.2. *(A first build was 98.75px — the bell was a hair taller than a dish line; it is 16px now.)*
- [x] 3.3 `KitchenBellMark` per D3: only when the order has marks; filled, primary, `kitchen-bell` swing while waiting; outline, muted, still when seen; reduced motion fades; dots absolutely placed under the bell, present whenever it rings, one kitchen included; accessible name.
- [x] 3.4 `open-orders-surface.tsx`: marks read with every rail load (so on foreground and every order nudge), and on the kitchen pulse alone; only on a counter with a live shift.
- [x] 3.8 No grey bell: once every kitchen has answered the bell is not drawn, its column kept (owner, on trying it, 2026-10-09). The read counts the outlet's kitchen tablets (`kitchenTablets`, pgTAP: 0 with none, 2 with two); the header's status is one segmented pill — *Kitchen offline* when a kitchen tablet is set up and none on shift, sync, *since 10:30 pm* — with the shift sentence moved to the Hand over screen and the buttons one step smaller. The marks are read once in `KitchenMarksProvider` and shared by rail and header. `counter-status-pill.test.tsx`; seen for real on the local stack with the spare till a kitchen and its shift ended, dark at 1024px and light at 1280px.
- [x] 3.7 The bell and its dot centred as one group between the customer and ⋮ buttons, 3px apart, 3px of air above and below; a one-dish card grows 98.25 → 104.5px for it (owner, on trying it, 2026-10-09). The dots' row is kept when empty so the bell never moves.
- [x] 3.6 A dot whenever the bell swings, one kitchen included (owner, on trying it, 2026-10-09). The bell is 15px and lifted 1.75px into the gap under the customer button, so a one-dish card's dot clears the ⋮ button (1.75px measured) and the card stays 98.25px.
- [x] 3.5 `pipeline-card-kitchen.test.tsx`: no bell without marks; waiting and seen; dots in place with a `null` gap; dots gone when seen; no word on the card; no bell on the docked card; the count tile. Existing pipeline card tests pass unchanged.

## 4. Docs

- [x] 4.1 `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/DEMO_MODE.md`, `docs/GLOSSARY.md` per the proposal.
- [x] 4.2 `npm run roadmap:sync`.

## 5. Verification

- [x] 5.1 Run what CI runs (`.github/workflows/verify.yml`, `docs.yml`): lint, format, typecheck, functions typecheck, contrast, unit, build, e2e, test:db, test:rls (fresh seed), e2e:auth, types current, docs lints. *(2026-10-09, fresh resets: lint, format, typecheck, functions:typecheck, contrast and the four docs lints green; `npm test` 2,332; build clean; `test:e2e` 314; `test:db` 82 files, 3,321; `test:rls` 293; `test:e2e:auth` 36; types current. Re-run after the header pill and the dropped grey bell: `npm test` 2,337; `test:e2e` 314; `test:db` passes (82 files); `test:rls` 293; `test:e2e:auth` 36; types current. One demo e2e run had 7 failures that two clean re-runs did not repeat, and one `test:db` run lost its container mid-run — both the shared machine, not this change. `81_the_kitchen_sees_its_orders.sql` had asserted that a counter reads no kitchen pulse; it now asserts it reads only its own outlet's, which is this change's contract.)*
- [x] 5.2 Demo, two tabs: a counter order shows a swinging bell; the kitchen tab's ACK stops it within seconds; an edit re-arms it. Both themes, tablet width; card heights against 0.2; reduced motion. *(Two tabs walked by script on 2026-10-09: the ACK stopped the counter's bell in 0.7 s; an edit set it swinging again; the ⋮ menu opens whole over the ticket. `e2e/counter.spec.ts` pins the height and the bell. Both themes, with and without reduced motion: every card 98.25px, the bell swinging (`kitchen-bell`) or fading (`kitchen-pulse`), no console error. The demo has one kitchen, so it shows one dot; dots across several kitchens are proved by the component, domain and pgTAP tests rather than in a browser.)*
- [x] 5.3 End to end on the local stack: `e2e-auth/kitchen-tablet.spec.ts` now checks the counter's bell swinging for the order, and stopping without a reload when the kitchen presses ACK, named for the kitchen.

## 6. Phase Gate

- [ ] 6.1 **PHASE GATE.** At an outlet with a live kitchen shift, every order on the billing tablet's rail that has a dish a kitchen shows carries a bell in the space beside its dishes, under the customer button — orange and swinging while any such kitchen has not pressed ACK on the order's latest version, and gone, its place kept, once every one has; an edit at the counter that changes a kitchen's dishes sets it swinging again; the swinging bell shows one dot per kitchen on shift, one kitchen included, always in the same place for the same kitchen, orange while that kitchen is waiting and grey once it has pressed ACK, and the dots disappear without moving anything when the bell stops; with no kitchen shift live at the outlet no card carries a bell, and the counter's header says *Kitchen offline* where the outlet has a kitchen tablet; a kitchen's ACK reaches the counter within seconds; the counter learns no more about the kitchen than which of its tablets has pressed ACK; the rail's cards take the kitchen ticket's torn top edge, its number face and its dish-count tiles at today's height — a one-dish card carrying the bell a few pixels taller, so the bell has room — and in today's colours; and the demo's counter tab shows its kitchen tab's ACKs.
