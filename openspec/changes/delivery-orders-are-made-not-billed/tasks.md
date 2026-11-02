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

- [x] 0.1 Branch from `origin/stage`. Take the next free migration timestamp
  after the newest on `stage` (`20261111000000_a_tablet_keeps_its_login.sql`
  when this was written), and after any unmerged change's migrations you can
  see in `openspec/changes/`, so no two share a version.
- [x] 0.2 Re-check that the key `delivery-orders` and the code `DO` are unused
  and not tombstoned. Re-count the independent live gates against the limit of
  five. If `delivery-orders` would be the sixth, stop and tell the owner which
  gates are due to retire.
- [x] 0.3 Read the paths this change mirrors, and note what you find in this
  file: `billing_order_guard`
  (`20261017000000_restore_counter_before_dish_ticks.sql`);
  `create_billing_order_v2`, `revise_billing_order_v2`, `prepare_order_lines_v2`,
  `order_label_leaves_the_rail` and `order_labels`
  (`20261019000000_…`, `20261031030000_contract_dish_ticks.sql`);
  `unpay_billing_order` (the take-back window and its clock); `kitchen_board_v2`,
  `counter_operations_snapshot_v2`, `overview_today_v2`, `billing_day_stats`,
  `billing_history_bills`, `sales_analytics_v2`, `sales_analytics_series_v2`,
  `set_outlet_service_settings`; and the counter's outbox command kinds.
- [x] 0.4 **Ask the owner to agree to replacing `billing_order_guard`** (design
  D3), in plain words: what changes, why nothing today's counters write is
  affected, and the fallback if they say no. Record the answer and date in
  design D3. Nothing in §1 that touches the guard starts until then.

### Notes from section 0 (2026-11-01)

- **0.1** Branched from `origin/stage` at `a02d358c`. Migration
  `20261112000000_delivery_orders_are_made_not_billed.sql`; no change folder or
  branch claims `202611[12]…`.
- **0.2** `delivery-orders` and `DO` are unused and not tombstoned. Independent
  live gates before this one: `pro-rata-pnl`, `auto-approve-at-the-shop`,
  `agreed-part-months`, `a-tablet-keeps-its-login` (four; `probe` is a self-test).
  `delivery-orders` is the fifth, at the limit.
- **0.4** The owner agreed to replacing the guard on 2026-11-01, and to a second
  widened object found while reading: `billing_commands.command_type` is a
  closed check, so the two new commands' kinds widen it (design D3, both
  recorded there).
- **0.3, what the reading changed:**
  - **The guard's branches read no gate.** D3 gated them on
    `app_change_gate('delivery-orders')`, but D9 promises that a handover or
    take-back queued while on still lands after the gate is off, which a gated
    guard would refuse. They are gated instead on `app.delivery_handover`, a
    transaction setting only the two new commands set, as `app.billing_command`
    is for every command. Every write a published build makes still takes
    today's path. To be told to the owner at §6, before any push.
  - **The server re-hashes every payload** (`billing_envelope_error`), so
    `_v3` cannot simply strip `delivery` and pass the caller's hash on. It
    checks the caller's hash over the whole payload, then calls `_v2` with the
    key removed and the hash recomputed. The stored hash is therefore the
    stripped one; `create_billing_order_v3` catches a replay that disagrees about
    `delivery` as `identity_conflict` instead.
  - **`order_line_preparations` keeps one row per line**, upserted, so a
    handover cannot be undone by deleting rows tagged with its command id. The
    handover stores what it changed in `delivery_orders.handover_prior_ticks`
    and the take-back puts exactly that back.
  - **There is no `counter_operations_snapshot` for the rail or My shift.** The
    counter reads `orders` and `bills` directly (the `_v2` of that name is the
    managers' tablet snapshot). The rail learns Delivery and My shift its
    handovers by reading `delivery_orders` under its RLS, wired in §7.
    `billing_day_stats` is read through `billing_day_numbers`, so its `_v2`
    carries both scopes (`billing_day_numbers_v2`), and the Stats switch costs no
    request.
  - The take-back window is `billing_edit_window_end(handed_over_at,
    prepared_at, true)`, exactly as `unpay_billing_order` measures a payment;
    a late arrival is `payment_edit_expired`, a status the outbox already knows.
  - Delivery refusals are `malformed_payload`, returned before the command is
    claimed, so nothing is recorded for them. A line's menu discount is allowed:
    it is the dish's own price, which a delivery order never shows.

## 1. The gate, off

- [x] 1.1 Declare `delivery-orders` (*DO*) in `src/change-gates/gates.ts`,
  depending on nothing, `roundTrip: 'tested'`, with a `retireBy` about three
  months out, and On and Off copied from the proposal.
- [x] 1.2 The migration's `change_gates` row, off. Header `-- change-gate:
  delivery-orders`. Run `npm run lint:migrations` and `npm run
  lint:change-gates`.
- [x] 1.3 Gate tests in both states (`describeChangeGate`), and the round-trip
  test skeleton tagged `@cg-round-trip:delivery-orders`.

## 2. Schema

One migration, every statement additive except the guard. Run `npm run
lint:migrations` after writing it.

- [x] 2.1 `alter type public.order_status add value 'handed_over'`;
  `outlets.delivery_offered boolean not null default false`.
- [x] 2.2 `delivery_orders`, `delivery_handover_takebacks`, `kept_order_labels`
  (design D1, D4, D5), each with `outlet_id`, RLS enabled, select policy as
  `order_labels_select`, no write grants.
- [x] 2.3 **Isolation tests (pgTAP) for each of the three tables**: a foreign
  outlet's Franchise Admin, a foreign counter, a kitchen and anonymous see no
  rows; nobody can insert, update or delete directly.
- [x] 2.4 `billing_order_guard` replaced per D3: today's body verbatim plus the
  two gated branches, under `-- release-lint: allow function-change — <reason,
  naming the owner's agreement and date>`. pgTAP: every existing billing test
  still passes; `open → handed_over` refused with the gate off or with no
  `delivery_orders` row; `handed_over → open` only changing status; any other
  change to a handed-over order refused.
- [x] 2.5 The gated triggers `orders_delivery_is_not_paid` and
  `orders_label_is_kept` (BEFORE UPDATE). pgTAP for each, on and off; that the
  kept label is the last one after a take-back and leaves again; and that the
  existing label-clearing still happens.
- [x] 2.6 `npm run db:types`, and check the diff for telemetry noise before
  trusting it.

## 3. Commands

- [x] 3.1 `create_billing_order_v3`, `revise_billing_order_v3` (D4): identical to
  `_v2` without `delivery`; with it, the refusals and the row. pgTAP: a `_v2`
  payload through `_v3` gives the same result; each refusal; idempotent replay.
- [x] 3.2 `hand_over_delivery_order`: ticks owed lines against the command id,
  attribution, status. pgTAP: owning tablet only; not-open refused; a
  non-delivery order refused; replay is a no-op; readiness no longer lists it;
  the kitchen board no longer returns it and returns no cancellation for it.
- [x] 3.3 `take_back_delivery_handover`: reason, the five-minute window measured
  as `unpay_billing_order` measures it, the takeback row, only the
  handover's ticks removed. pgTAP for each, and for a late arrival.
- [x] 3.4 `set_outlet_service_settings_v2` with `delivery_offered`. pgTAP: the
  owner and the outlet's managers may; a Biller, another outlet's manager and
  anonymous may not.
- [x] 3.5 The outbox command kinds for handover and take-back, and the create and
  revise variants carrying `delivery`, with the existing envelope and
  idempotency. **The outbox does not import a gate** (the existing test holds).

## 4. Reads

- [x] 4.1 `kitchen_board_v3`, `counter_operations_snapshot_v3`,
  `overview_today_v3` (D6). pgTAP: `_v3` equals `_v2` on a day with no delivery
  orders; the delivery flag; My shift's delivery rows; kept labels on bills;
  `openPaise` without delivery.
  *Done as built:* there is no `counter_operations_snapshot` (see 0.2's note);
  My shift reads the shift's handovers from `delivery_orders` beside its bills,
  and the rail reads `delivery_orders(handed_over_at)` embedded in its order
  read, so the rail costs no extra request.
- [x] 4.2 `billing_day_stats_v2(…, scope)`, `billing_history_bills_v2`,
  `billing_history_delivery_orders`. pgTAP: `counter` equals today's figures
  less delivery orders; `delivery` counts; foreign-outlet refusal.
- [x] 4.3 `sales_analytics_v3`, `sales_analytics_series_v3` (and Items' own read
  if it has one) with `scope`. pgTAP: `counter` equals `_v2` exactly; `delivery`
  counts handed-over orders and item quantities only; no revenue in delivery;
  foreign-outlet refusal.
- [x] 4.4 **A no-money check:** a pgTAP or lint test that no new read returns
  a delivery order's `total_paise`, `subtotal_paise` or line prices.
- [x] 4.5 Typed adapter methods for every read and command, live and mock, typed
  from the generated schema.

## 5. Screens, in the demo

Every edit is the on branch of `useChangeGate('delivery-orders')`. Reshape each
moved surface's shimmer in the same task.

- [x] 5.1 The outlet's Orders section: the **Delivery** switch.
- [x] 5.2 The composer: the **Delivery** chip; the hidden total, customer and
  discount; **Order** only (D7).
- [x] 5.3 The rail card: **Delivery**, no total, **Hand over**, with the
  optimistic removal.
- [x] 5.4 My shift: delivery rows, **Take back** inside the window, its reasoned
  confirmation; kept labels on bills.
- [x] 5.5 The kitchen card: **Delivery** in the service slot.
- [x] 5.6 The **Counter · Delivery** switch on Stats, Billing History, Items and
  Sales (D7), remembered per page in try/catch-wrapped storage, with the
  unavailable measures disabled and saying why.
- [x] 5.7 Demo fixtures (design, *Demo*), and `docs/DEMO_MODE.md` notes.
- [x] 5.8 Unit tests for each toggle point, both states. Browser tests tagged
  `@cg-on:delivery-orders`; any existing test the change contradicts tagged
  `@cg-off:delivery-orders` and otherwise untouched.
- [x] 5.9 Contrast validator in both themes; screenshots of every screen on a
  tablet (counter, kitchen) and a phone (the rest), light and dark.

### Where §1–5 stand at the checkpoint (2026-11-01)

The owner asked for the demo first and the hard building after, so the screens
went to them before the remaining tests. Done: the gate, the whole migration
(applies on a fresh reset, `lint:migrations` clean), `db:types`, the adapter
interface, every mock, every screen in the demo, the fixtures, and the contrast
check (98 pairs, both themes). Written but **not yet run**: the pgTAP suite
`supabase/tests/99_delivery_orders_are_made_not_billed.sql` (2.3–2.5, 3.1–3.4,
4.1–4.4). Not yet done: 1.3 and 5.8 (unit tests per toggle point, `@cg-on` and
round-trip browser tests, which `lint:change-gates` requires), 3.5 (the outbox
kinds), the live counter's half of 4.5 (handover, take-back, the rail's and My
shift's reads, the menu read's `delivery_offered`), and 5.7's
`docs/DEMO_MODE.md` notes. Already live behind the gate: kitchen board,
Billing history rows, day numbers, delivery history, analytics, the outlet's
Delivery switch.

Changed by the owner at the first demo round (2026-11-01), all in the demo:

- **A delivery card is blue wherever another card is orange**, so the counter
  picks delivery orders out at a glance and no card mixes the two. One class,
  `delivery-theme` in `tokens.css`, swaps `--primary`, `--on-primary`,
  `--accent-text` and the Ready fill for the `--delivery-*` tokens; the composer's
  chosen Delivery chip wears it too. Hand over takes the card's own accent.
  Colour only replaces colour that was there: the tag's words, My shift and
  Billing history stay plain. The one exception the owner asked for: the
  kitchen's DELIVERY tag is solid blue, so the kitchen tells delivery tickets at
  a glance too. Every kitchen tag carries the counter's icon for its service
  (bag, plates, bike), and a done ticket folded away keeps the icon alone beside
  its number, blue for delivery and muted for the rest, so a finished delivery
  is still told apart.
- **Billing history → Delivery is a tab** beside Bills, Open orders and Stats,
  not a switch over the bills: delivery orders are not bills.
- **Counter · Delivery is a small pill**, not a full-width switch: on Sales and
  Items after Compare, both as icons only so the two pickers keep their width;
  on Stats at the right of the sync chip's line, so it never takes a row of its
  own. It opens a sheet with the two choices and lights up only while it reads
  Delivery. The owner reads delivery figures now and then, so the choice stays
  out of the page's way.
- A delivery dish's note is blue, as the card's accent text is (`No mayo` in
  the demo).

Third demo round (2026-11-01):

- **The composer keeps what is touched to place an order together**, with
  `delivery-orders` on at every outlet: the customer row heads the panel, and the
  label, the service chips and Order or Paid sit together at its foot, so the
  chips never move when Delivery hides the total and the customer. Checked
  against production first: of 1,791 paid orders with a number in the last 30
  days, 1,614 (90%) had it added within two minutes of payment, 167 at the order.
- **Hand over waits for every dish to be ticked.** The card's control is
  disabled until then. The server still ticks what is owed (D4), so a handover
  queued behind its ticks never becomes needs-attention work.
- **A handover stays on the rail for five seconds**, ticked, its word
  unchanged; unticking it is the take-back, recorded with the reason `Undone on
  the rail`. The ticked box starts in the card's blue and a deeper blue
  (`--delivery-filled`) fills it from the left over the five seconds; full, the card fades as a kitchen ticket leaves and the others
  close up after it. The owner chose this from five countdowns tried on a page
  of their own. The card is held before the write, and its ⋮ stays in place,
  disabled, since Edit and Cancel order need an open order, so nothing on the
  card moves when it is tapped.
- **Billing history: Bills · Delivered · Open orders · Stats.** Delivered is
  done work, as bills are. Its Handed over chip is blue. An open delivery order
  in Open orders shows no money and no customer, and only its Delivery chip is
  blue: the blue card is for a busy counter, not this page. Once made it sits
  under **Ready to hand over**, never under Unpaid
  Prepared Orders. The four tabs fit a 412 px phone on one line.

## 6. CHECKPOINT: the owner approves the demo

- [x] 6.1 Send the owner the screenshots and the demo walk: compose a delivery
  order, the kitchen rings, hand over, take back, hand over again, then Stats,
  History, Items and Sales in Delivery. **Stop until they approve.** Record
  their changes here and apply them before §7.
  **Approved by the owner on 2026-11-01** ("we're good, build it end to end"),
  after five rounds whose changes are recorded above under §5's notes. Also
  settled in the last round: the counter's rail keeps re-dealing its columns
  when a card leaves (cards may cross columns), as it always has; the owner
  declined both the kitchen's fixed columns and a fade for cards changing
  column.

## 7. Wired live

- [x] 7.1 Live adapters for every new read and command.
- [x] 7.2 The round-trip browser test (D9): a delivery create and a handover
  queued offline with the gate on, the gate turned off, reconnect, both land.
- [ ] 7.3 A browser test that, with the gate on, an idle counter and kitchen,
  a handover and an ACK stay within `e2e-auth/request-budget.spec.ts`
  unchanged.
- [x] 7.4 A hand-crafted-request browser or pgTAP test for each refusal the
  proposal promises: paying a delivery order, a foreign outlet's reads, a
  Biller turning Delivery on.
  *Done in pgTAP* (`99_delivery_orders_are_made_not_billed.sql`): paying a
  delivery order with the gate on, the other outlet's manager on every new read
  and table, and a Biller calling `set_outlet_service_settings_v2`.

## 8. Verify

- [ ] 8.1 Locally: quick gates and DB gates per `.github/workflows/verify.yml`
  (re-reset the shared Supabase container first).
- [ ] 8.2 Push to `stage` (`git push origin HEAD:stage`) and let Staging run both
  browser suites, gates off and on. Fix what fails.
- [ ] 8.3 Walk it on staging's fake outlet with the gate on and Delivery offered,
  then turn the gate off with a delivery order open and one handed over, and
  check the off path reads as the proposal says.

## 9. Durable documentation

- [x] 9.1 Update every page the proposal names: `docs/BUSINESS_CONTEXT.md`
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
