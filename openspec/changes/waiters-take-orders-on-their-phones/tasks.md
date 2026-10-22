# Tasks: waiters-take-orders-on-their-phones

Read `proposal.md` and `design.md` first. The owner's nineteen decisions and the
rejected alternatives are in the design. Do not reopen them without a reason it
did not consider.

**The demo comes first, and the owner approves it before anything is wired
live** (owner, 2026-10-21). Sections 1–4 build the gates, the pure rules, the
table shapes the mocks are typed from, and every screen in the demo. Section 5
is the checkpoint. Nothing after it starts until the owner has approved the
screens, and **no commit carrying a migration is pushed to `stage` before
then**, so the schema stays editable while the screens are argued over.

The off path is today's code, untouched. Every edit to an existing screen is a
new branch taken only when `useChangeGate('waiter-orders')` or
`useChangeGate('any-counter-acts')` is true, and every database object is new.

## 0. Before anything

- [ ] 0.1 Branch from `origin/stage`. Take the next free migration timestamps
  after the newest on `stage`, one for each gate's migration.
- [ ] 0.2 Re-check that the keys `waiter-orders` and `any-counter-acts` and the
  codes `WO` and `AC` are unused and not tombstoned, and count the root gates:
  these two must fit under the limit of five. If `retire-one-revenue` has not
  landed and they do not fit, stop and tell the owner.
- [ ] 0.25 `staff-roles-include-other-roles` is on `stage` before §6 starts, and its
  cleanup has run in production before `waiter-orders` is turned on (§11). The
  demo (§1–§5) does not wait for it.
- [ ] 0.3 Find, and note in this file, the attendance function that computes an
  inside, outside or unverifiable verdict from a reading, the column that says a
  check-in was denied, the Team path's function that writes an Employee
  assignment, and how the counter's `subscribe` takes a second table on its
  outlet channel.

## 1. The gates, off

- [ ] 1.1 Declare `waiter-orders` (`WO`) and `any-counter-acts` (`AC`) in
  `src/change-gates/gates.ts`, `kind: 'change'`, `change:
  'waiters-take-orders-on-their-phones'`; `waiter-orders` with `dependsOn:
  ['role-includes']` and `any-counter-acts` with none; `retireBy` about eight
  weeks after first turned on, `roundTrip: 'tested'`, with doc comments in the
  file's voice.
- [ ] 1.2 Migration `<ts1>_waiters_take_orders.sql`, header `-- change-gate:
  waiter-orders`, first statement the `change_gates` row, off, with `on_means`
  and `off_means` word for word from the proposal, `change_number` 80.
- [ ] 1.3 Migration `<ts2>_any_counter_acts.sql`, header `-- change-gate:
  any-counter-acts`, first statement its row, off, likewise.
- [ ] 1.4 Both gates' words in `WORDS` in `src/data-access/mock/change-gates.ts`.
- [ ] 1.5 `npm run lint:migrations`, `npm run lint:change-gates` (expected red
  until §9's browser tests exist; say so here), and the change-gate suite: both
  rows read back off.

## 2. The rules, pure

- [ ] 2.1 Failing tests first, then `src/domain/waiter-requests.ts`:
  - `applyChange(order, change)`: added lines; `less` taking unmade food first
    and never below made; changed notes on unmade food only; changed table,
    service and label; edits that cannot apply (line gone, food made
    since, item now unavailable) returned as a list, not applied.
  - `describeChange(change, order)`: *+1 Chicken Burger · −1 Coke · Table 4 → 6*,
    in the rail's words.
  - `changeFromDraft(order, draft)`: the waiter's composer state turned into
    `add`, `less`, `notes` and `set`, and nothing for fields unchanged.
  - `presenceLight(row, now)`: 🟢, 🟡 with minutes left, 🔴; the 15-minute and
    3-minute edges; a null row; permission denied; the approximate-location line
    when accuracy is wider than the radius.
- [ ] 2.2 `src/domain/waiter-request-cases.json`: the `applyChange` and
  `presenceLight` cases as data, read by Vitest now and by pgTAP in §6.

## 3. The table shapes the mocks are typed from

- [ ] 3.0 Migration `<ts0>_the_waiter_rung.sql`, before `<ts1>`: `alter type
  public.app_role add value 'waiter'`, alone (design D1).
- [ ] 3.1 In `<ts1>`, after the gate row: the `staff_roles` row for Waiter and the rows *Waiter includes Employee* and *Biller includes Waiter*;
  `order_requests` and `waiter_presence` (design D1, D3, D4) with their checks, foreign keys, RLS on,
  the policies of design *RLS and authority*, no-delete triggers, and the
  gated `kitchen_pulses` select policy (D6). No functions yet. `npm run
  lint:migrations`.
- [ ] 3.2 `npm run db:reset`, `npm run db:types`; check the diff holds only the
  new tables (`db-types-telemetry-noise`).
- [ ] 3.3 `WaiterAdapter` in `src/data-access/adapters.ts`: check presence, read
  the board, send, take back, dismiss. The counter adapter
  gains waiting requests, reject, and the `requestId` and `baseVersion` its
  create and revise carry. The accounts adapter gains the Waiter choice. Types
  from the generated rows.

## 4. The demo

- [ ] 4.1 The mock adapter over the shared store, folding with
  `src/domain/waiter-requests.ts` so demo and live cannot disagree; a Waiter
  persona checked in at the demo outlet; one waiting new order and one waiting
  change when the demo opens; a second demo tablet's open order.
- [ ] 4.2 The demo banner's role switcher gains **Waiter**, on the phone shell,
  and a **location** control on that walkthrough alone (*Inside*, *Weak signal*,
  *Outside for 15 minutes*), like the counter's connectivity control.
- [ ] 4.3 The **Orders** tab (design D12): the location light with Retry, Your
  requests, Live orders, New order and the phone composer with its bottom
  sheet, Send change on an existing order, Show to counter, Counter is closed,
  Not checked in. The counter's words throughout. Surface registry entry
  `hidden` → `demo`.
- [ ] 4.4 The counter (design D7): the Waiting card at the top of the rail, its
  ring, the filled composer with Accept and Reject, the change composer with
  marks and the *changed since* line, the restored draft, Accept greyed offline.
  Finish Day's step naming waiting requests.
- [ ] 4.5 The ring: add two or three candidates to the tune lab and let the owner
  pick by ear in the demo round (`kitchen-sounds-loud-and-chosen-by-ear`).
- [ ] 4.6 `any-counter-acts` in the demo: with it on, the second tablet's order
  opens for edit and payment; with it off, refused as today; an
  `order_changed` refusal shown once.
- [ ] 4.7 Team's Waiter choice, and a Waiter shown as Waiter.
- [ ] 4.8 The round trip by switching roles: the Waiter sends, the counter
  accepts, the Waiter reads *Accepted as #N* and the order on the list.
- [ ] 4.9 Look at every new screen on a phone viewport and the counter on a
  tablet viewport, light and dark; `npm run contrast`. Reshape the rail's
  shimmer for the Waiting card. Demo browser tests tagged `@cg-on:waiter-orders`
  and `@cg-on:any-counter-acts`; tag any existing test the change contradicts
  `@cg-off:<key>`, and edit it no further.
- [ ] 4.10 Screenshots of each screen for the owner, in the conversation.

## 5. CHECKPOINT: the owner's demo round

- [ ] 5.1 The owner walks the demo: the Orders tab and its light, a send, Show
  to counter, the Waiting card, both Accept composers, Reject, Team's Waiter,
  and a neighbouring tablet's order. Record every decision under *The owner's
  demo round* in `design.md`, fix, and re-show until approved. **Nothing below
  starts before approval.**

## 6. The database, `waiter-orders`

- [ ] 6.1 In `<ts1>`: `app_may_take_orders_at(outlet)` (D1, D2);
  `waiter_check_presence` with the 20-second limit (D3); `waiter_send_request`
  with every refusal code (D5); `waiter_take_back`; `waiter_board_v1` and `waiter_menu_v1` (D6); `counter_waiting_requests_v1` and
  `counter_reject_request` (D7); each
  refusing `gate_off` while the gate is off. `security definer`, `search_path =
  ''`. `npm run lint:migrations`.
- [ ] 6.2 `create_billing_order_v3` and `revise_billing_order_v3` accepting
  `requestId` (D8), marking the request, nulling its phone, refusing
  `request_not_waiting`. They are shared with §7; write them once, in the
  migration that lands first, and say which here.
- [ ] 6.3 pgTAP, a new numbered file: every refusal of D5 and D8; the presence
  verdict and its 15 minutes against `waiter-request-cases.json`; no coordinates
  stored; a pending check-in counts and a denied one does not; derived expiry;
  the request's phone gone after an answer; Accept allocating the number; a
  taken-back request refusing Accept.
- [ ] 6.4 Isolation, in `test:rls` and pgTAP, for **each of the two tables**
  and every function: another outlet's waiter, biller, counter and manager
  refused; an Employee refused; a kitchen shift reads nothing; a
  manager cannot read presence; no direct insert, update or delete for any
  client role; a waiter refused every billing command, discount and points
  path.

## 7. The database, `any-counter-acts`

- [ ] 7.1 In `<ts2>`: `pay_billing_order_v2`, `cancel_billing_order_v2`,
  `prepare_order_lines_v3`, and the revise and create of 6.2 if they land here,
  each taking `baseVersion` where design D9 says, refusing `order_changed`, and
  checking the owner unless `app_change_gate('any-counter-acts')`. Untouched
  `_v2` and unversioned functions stay as they are. `npm run lint:migrations`.
- [ ] 7.2 pgTAP: both gate states for every command; a neighbour's revise, pay
  and cancel refused `not_owner` off and landing on; two revises from version V,
  the second refused; an offline-style payment against a moved order refused
  `order_changed`, no bill and no number consumed, order still open; a tick on a
  removed line accepted and changing nothing; tender correction and payment
  take-back still owner-only with the gate on.
- [ ] 7.3 `npm run db:reset`, `npm run db:types`, check the diff.

## 8. Live adapters

- [ ] 8.1 The Supabase `WaiterAdapter`: presence on open, foreground, every three
  minutes while visible, and Retry; the board re-read on the outlet's
  `order_requests` and `kitchen_pulses` changes and on the foreground; the draft
  kept in `localStorage` (wrapped in try/catch) until sent.
- [ ] 8.2 The counter: the request table on its existing outlet channel, read only
  when it fires or on the foreground, under `waiter-orders`; Reject; Accept
  through the outbox as `create_order` or `revise_order` with variant
  `versioned`.
- [ ] 8.3 The outbox routes variant `versioned` to the `_v3` and `_v2` functions
  of D9, reading the command and never a gate; envelopes without it go where
  they always have.
- [ ] 8.4 Under `any-counter-acts`: every ordinary command carries `baseVersion`
  with variant `versioned`; another tablet's order greyed offline with *Needs a
  connection*; `order_changed` shown as *This order changed on another counter.
  Reopen it.*, with discard only.
- [ ] 8.5 Team offers Waiter, written through the existing assignment path; the
  includes map gains `waiter: ['employee']` and Biller's `'waiter'`, with its shell order, label and path segment.
- [ ] 8.6 Promote the Orders surface `demo` → `live` behind `waiter-orders`, and
  confirm the demo still walks.

## 9. Both ways

- [ ] 9.1 Unit tests for every toggle point with `describeChangeGate`.
- [ ] 9.2 Authenticated browser tests, tagged `@cg-on`: a Waiter checks in, goes
  🟢, sends, the counter accepts, the kitchen board shows the order; a change
  accepted on a neighbouring tablet; a stale edit refused.
- [ ] 9.3 `@cg-round-trip:waiter-orders` and `@cg-round-trip:any-counter-acts`
  as design D13 describes.
- [ ] 9.4 The request budget: an idle counter with `waiter-orders` on at the old
  number; a new idle-waiter case for a measured minute, its budget recorded in
  this diff with the reason.
- [ ] 9.5 Offline, by hand on the counter: go offline, ring and pay own orders,
  come back, exactly-once settlement; then an own payment racing a neighbour's
  edit, refused once, order still open, paid again.
- [ ] 9.6 `npm run format`, then lint, `format:check`, both typechecks, `npm
  test`, `contrast`, `build`, and the database job through the types diff.
  Push to `stage` and read the Staging run for the four browser suites.

## 10. Docs

- [ ] 10.1 Every page in the proposal's *Docs To Update Before Archive*.

## 11. Release

- [ ] 11.1 Once Staging has published, the owner tries both gates on the fake
  outlet, with a second phone as the Waiter.
- [ ] 11.2 After Promote, at a quiet hour: turn `any-counter-acts` on first and
  watch the tablets through a service; then make the first Waiters on Team and
  turn `waiter-orders` on.
- [ ] 11.3 Pull each once, off and on again.
- [ ] 11.4 A week in, read `waiter_presence` verdicts at the outlet. If waiters
  sit on 🔴 inside the outlet often, raise the counter code with the owner
  (design, rejected alternatives).

## 12. PHASE GATE

- [ ] 12.1 The checkpoint in ROADMAP.md row #80 holds, every item checked against
  the running app: the owner approved the demo before it was wired live; a
  Waiter checked in and confirmed inside in the last 15 minutes sends a new order
  or a change from their phone; nothing reaches an order, a number or a kitchen
  until a counter accepts it from a filled-in composer; a waiter never pays,
  ticks, cancels an accepted order, discounts or uses points, refused by the
  database from a hand-crafted request; with `any-counter-acts` on, any counter
  acts on any open order and a stale edit or payment is refused rather than
  overwriting; and with both gates off everything behaves as today.
