# Tasks: delivery-orders-are-made-not-billed

Read `proposal.md` and `design.md` first. The owner's seven decisions and the
rejected alternatives are in the design. Do not reopen them without a reason
it did not consider.

**The demo comes first, and the owner approves it before anything is wired
live.** Sections 1–5 build the gate, the schema shapes the mocks are typed
from, and every screen in the demo. Section 6 is the checkpoint. **No commit
carrying the migration is pushed to `stage` before the owner has approved the
screens and agreed to the guard replacement (D3)**, so the schema stays
editable while the screens are argued over.

**The off path is today's code, untouched.** Every edit to an existing screen is
a new branch taken only when `useChangeGate('delivery-orders')` reads on. Every
database object is new, except `billing_order_guard` (D3).

## 0. Before anything

- [ ] 0.1 Branch from `origin/stage`. Take the next free migration timestamp
  after the newest on `stage` (`20261111000000_a_tablet_keeps_its_login.sql`
  when this was written), and after any unmerged change's migrations you can
  see in `openspec/changes/`, so no two share a version.
- [ ] 0.2 Re-check that the key `delivery-orders` and the code `DO` are unused
  and not tombstoned. Re-count the independent live gates against the limit of
  five. If `delivery-orders` would be the sixth, stop and tell the owner which
  gates are due to retire.
- [ ] 0.3 Read the paths this change mirrors, and note what you find in this
  file: `billing_order_guard`
  (`20261017000000_restore_counter_before_dish_ticks.sql`);
  `create_billing_order_v2`, `revise_billing_order_v2`, `prepare_order_lines_v2`,
  `order_label_leaves_the_rail` and `order_labels`
  (`20261019000000_…`, `20261031030000_contract_dish_ticks.sql`);
  `unpay_billing_order` (the take-back window and its clock); `kitchen_board_v2`,
  `counter_operations_snapshot_v2`, `overview_today_v2`, `billing_day_stats`,
  `billing_history_bills`, `sales_analytics_v2`, `sales_analytics_series_v2`,
  `set_outlet_service_settings`; and the counter's outbox command kinds.
- [ ] 0.4 **Ask the owner to agree to replacing `billing_order_guard`** (design
  D3), in plain words: what changes, why nothing today's counters write is
  affected, and the fallback if they say no. Record the answer and date in
  design D3. Nothing in §1 that touches the guard starts until then.

## 1. The gate, off

- [ ] 1.1 Declare `delivery-orders` (*DO*) in `src/change-gates/gates.ts`,
  depending on nothing, `roundTrip: 'tested'`, with a `retireBy` about three
  months out, and On and Off copied from the proposal.
- [ ] 1.2 The migration's `change_gates` row, off. Header `-- change-gate:
  delivery-orders`. Run `npm run lint:migrations` and `npm run
  lint:change-gates`.
- [ ] 1.3 Gate tests in both states (`describeChangeGate`), and the round-trip
  test skeleton tagged `@cg-round-trip:delivery-orders`.

## 2. Schema

One migration, every statement additive except the guard. Run `npm run
lint:migrations` after writing it.

- [ ] 2.1 `alter type public.order_status add value 'handed_over'`;
  `outlets.delivery_offered boolean not null default false`.
- [ ] 2.2 `delivery_orders`, `delivery_handover_takebacks`, `kept_order_labels`
  (design D1, D4, D5), each with `outlet_id`, RLS enabled, select policy as
  `order_labels_select`, no write grants.
- [ ] 2.3 **Isolation tests (pgTAP) for each of the three tables**: a foreign
  outlet's Franchise Admin, a foreign counter, a kitchen and anonymous see no
  rows; nobody can insert, update or delete directly.
- [ ] 2.4 `billing_order_guard` replaced per D3: today's body verbatim plus the
  two gated branches, under `-- release-lint: allow function-change — <reason,
  naming the owner's agreement and date>`. pgTAP: every existing billing test
  still passes; `open → handed_over` refused with the gate off or with no
  `delivery_orders` row; `handed_over → open` only changing status; any other
  change to a handed-over order refused.
- [ ] 2.5 The gated triggers `orders_delivery_is_not_paid` and
  `orders_label_is_kept` (BEFORE UPDATE). pgTAP for each, on and off; that the
  kept label is the last one after a take-back and leaves again; and that the
  existing label-clearing still happens.
- [ ] 2.6 `npm run db:types`, and check the diff for telemetry noise before
  trusting it.

## 3. Commands

- [ ] 3.1 `create_billing_order_v3`, `revise_billing_order_v3` (D4): identical to
  `_v2` without `delivery`; with it, the refusals and the row. pgTAP: a `_v2`
  payload through `_v3` gives the same result; each refusal; idempotent replay.
- [ ] 3.2 `hand_over_delivery_order`: ticks owed lines against the command id,
  attribution, status. pgTAP: owning tablet only; not-open refused; a
  non-delivery order refused; replay is a no-op; readiness no longer lists it;
  the kitchen board no longer returns it and returns no cancellation for it.
- [ ] 3.3 `take_back_delivery_handover`: reason, the five-minute window measured
  as `unpay_billing_order` measures it, the takeback row, only the
  handover's ticks removed. pgTAP for each, and for a late arrival.
- [ ] 3.4 `set_outlet_service_settings_v2` with `delivery_offered`. pgTAP: the
  owner and the outlet's managers may; a Biller, another outlet's manager and
  anonymous may not.
- [ ] 3.5 The outbox command kinds for handover and take-back, and the create and
  revise variants carrying `delivery`, with the existing envelope and
  idempotency. **The outbox does not import a gate** (the existing test holds).

## 4. Reads

- [ ] 4.1 `kitchen_board_v3`, `counter_operations_snapshot_v3`,
  `overview_today_v3` (D6). pgTAP: `_v3` equals `_v2` on a day with no delivery
  orders; the delivery flag; My shift's delivery rows; kept labels on bills;
  `openPaise` without delivery.
- [ ] 4.2 `billing_day_stats_v2(…, scope)`, `billing_history_bills_v2`,
  `billing_history_delivery_orders`. pgTAP: `counter` equals today's figures
  less delivery orders; `delivery` counts; foreign-outlet refusal.
- [ ] 4.3 `sales_analytics_v3`, `sales_analytics_series_v3` (and Items' own read
  if it has one) with `scope`. pgTAP: `counter` equals `_v2` exactly; `delivery`
  counts handed-over orders and item quantities only; no revenue in delivery;
  foreign-outlet refusal.
- [ ] 4.4 **A no-money check:** a pgTAP or lint test that no new read returns
  a delivery order's `total_paise`, `subtotal_paise` or line prices.
- [ ] 4.5 Typed adapter methods for every read and command, live and mock, typed
  from the generated schema.

## 5. Screens, in the demo

Every edit is the on branch of `useChangeGate('delivery-orders')`. Reshape each
moved surface's shimmer in the same task.

- [ ] 5.1 The outlet's Orders section: the **Delivery** switch.
- [ ] 5.2 The composer: the **Delivery** chip; the hidden total, customer and
  discount; **Order** only (D7).
- [ ] 5.3 The rail card: **Delivery**, no total, **Hand over**, with the
  optimistic removal.
- [ ] 5.4 My shift: delivery rows, **Take back** inside the window, its reasoned
  confirmation; kept labels on bills.
- [ ] 5.5 The kitchen card: **Delivery** in the service slot.
- [ ] 5.6 The **Counter · Delivery** switch on Stats, Billing History, Items and
  Sales (D7), remembered per page in try/catch-wrapped storage, with the
  unavailable measures disabled and saying why.
- [ ] 5.7 Demo fixtures (design, *Demo*), and `docs/DEMO_MODE.md` notes.
- [ ] 5.8 Unit tests for each toggle point, both states. Browser tests tagged
  `@cg-on:delivery-orders`; any existing test the change contradicts tagged
  `@cg-off:delivery-orders` and otherwise untouched.
- [ ] 5.9 Contrast validator in both themes; screenshots of every screen on a
  tablet (counter, kitchen) and a phone (the rest), light and dark.

## 6. CHECKPOINT: the owner approves the demo

- [ ] 6.1 Send the owner the screenshots and the demo walk: compose a delivery
  order, the kitchen rings, hand over, take back, hand over again, then Stats,
  History, Items and Sales in Delivery. **Stop until they approve.** Record
  their changes here and apply them before §7.

## 7. Wired live

- [ ] 7.1 Live adapters for every new read and command.
- [ ] 7.2 The round-trip browser test (D9): a delivery create and a handover
  queued offline with the gate on, the gate turned off, reconnect, both land.
- [ ] 7.3 A browser test that, with the gate on, an idle counter and kitchen,
  a handover and an ACK stay within `e2e-auth/request-budget.spec.ts`
  unchanged.
- [ ] 7.4 A hand-crafted-request browser or pgTAP test for each refusal the
  proposal promises: paying a delivery order, a foreign outlet's reads, a
  Biller turning Delivery on.

## 8. Verify

- [ ] 8.1 Locally: quick gates and DB gates per `.github/workflows/verify.yml`
  (re-reset the shared Supabase container first).
- [ ] 8.2 Push to `stage` (`git push origin HEAD:stage`) and let Staging run both
  browser suites, gates off and on. Fix what fails.
- [ ] 8.3 Walk it on staging's fake outlet with the gate on and Delivery offered,
  then turn the gate off with a delivery order open and one handed over, and
  check the off path reads as the proposal says.

## 9. Durable documentation

- [ ] 9.1 Update every page the proposal names: `docs/BUSINESS_CONTEXT.md`
  (step 4 of the counter workflow still says aggregator orders are paid at the
  counter — correct it; the label is kept), `docs/SCREENS.md`,
  `docs/DATA_MODEL.md`, `docs/GLOSSARY.md`, `docs/LIMITATIONS.md`,
  `docs/DEMO_MODE.md`, `docs/TESTING.md`. Correct every page that says the
  label is thrown away, not only one.

## 10. Release

- [ ] 10.1 The owner approves a Promote at a quiet hour; the build reaches the
  counters off.
- [ ] 10.2 `/release delivery-orders`, with Kalyani Cafe's Delivery still off;
  then Delivery on for the Cafe. Watch the first service's delivery orders
  through the kitchen, handover and My shift. Pull it once, off and on, with no
  delivery order on the rail.

## 11. PHASE GATE

- [ ] 11.1 The checkpoint in ROADMAP.md row #83 holds, every item checked
  against the running app:
  - the owner approved the demo before it was wired live, and agreed to the
    guard replacement;
  - a delivery order is saved with a number, rings the kitchen reading
    *Delivery*, is handed over without a bill, and is listed in My shift and
    Billing History with its label and no amount;
  - a handover is taken back within five minutes and refused after;
  - paying a delivery order, and a foreign outlet's read, are refused by the
    database from hand-crafted requests;
  - labels are kept after an order leaves the rail and never reach a bill,
    receipt or export;
  - Stats, Billing History, Items and Sales read exactly as before in Counter,
    and show delivery orders alone in Delivery, with no money figures;
  - with the gate off every order is billed or cancelled as today, and queued
    delivery work drains;
  - the gate was turned on in production and pulled once;
  - the four-role demo walkthrough still walks.
