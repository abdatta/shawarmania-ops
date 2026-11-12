# Tasks: retire-delivery-orders

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half. Counter and kitchen runtime.

## 0. Preconditions

- [x] 0.1 The change is archived: `delivery-orders-are-made-not-billed` (#83),
  on 12 November, the pull waived under the owner's rule of 30 October.
- [x] 0.2 The gate is on in production and has stayed on.
  *(`change_gate_events`: on at 11:15 IST on 2 November, nothing since; 82
  delivery orders made by 12 November, 78 handed over, 2 taken back.)*
- [x] 0.3 Nothing depends on it.
- [x] 0.4 The owner's "happy to retire it": 12 November, "go ahead" to retiring
  AM, TK and DO.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: the composer offers Delivery
  where the outlet does, with the label beside the chips and the customer row
  at the panel's head; Billing History has Delivered and the Stats scope pill;
  Items and Sales have the Counter · Delivery pill; the outlet's Orders card has
  Delivery; the kitchen's tag carries its icon and a finished receipt fades
  while the board closes up.
- [x] 1.2 The adapters always read and write through what knows a delivery
  order: `kitchen_board_v3`, `overview_today_v3`, `sales_analytics_v3` and its
  series, `billing_history_bills_v2`, `billing_day_numbers_v2`,
  `set_outlet_service_settings_v2`, the label and delivery embeds, and new order
  commands in the `delivery` variant. The outbox still routes a `dishes`
  command queued by an older build.
- [x] 1.3 The off path's code goes: `src/change-gates/delivery-orders.ts`, the
  demo's `deliveryOrders` option, the footer's customer-and-service row
  (`CustomerServiceRow`) and the kitchen's shrink-and-gap exit with its
  `kitchen-ready-exit` animation.
- [x] 1.4 The key moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out of
  the demo's gate words.
- [x] 1.5 Tests: `delivery-orders.test.ts` becomes plain tests of the reads; the
  kitchen hook's exit-and-gap test goes and its old-timer test ends on the fade;
  the snapshot, build stamp and demo switchboard tests name `deactivate-then-leave`
  as their example gate. The round trip was `tested`, so
  `e2e-auth/delivery-orders.spec.ts` is deleted, not untagged; the `@cg-on`
  tags drop from `e2e/delivery-orders.spec.ts` and `e2e-auth/request-budget.spec.ts`.
  `supabase/tests/99_delivery_orders_are_made_not_billed.sql` still turns the
  row, which the database reads until the contract migration.
- [x] 1.6 The `counter-billing`, `kitchen-display`, `order-lifecycle`,
  `sales-analytics` and `service-and-packaging` deltas; `docs/`
  (BUSINESS_CONTEXT, DATA_MODEL, GLOSSARY, LIMITATIONS, ROLES_AND_PERMISSIONS,
  SCREENS, SECURITY_AND_PRIVACY, TESTING) no longer calls the behaviour gated.
- [x] 1.7 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`; the database and browser suites on Staging.
  *(12 November: every local gate green, 3,374 unit tests; Staging run
  43178344123 green on `aa102720`, every database, demo and auth browser job.)*
- [x] 1.8 Release: push to `stage`, Staging green, the owner promotes. The row is
  left on, so a tablet on an older build keeps the behaviour it has.
  *(Promote run 43190557656 moved `main` to `f632cc42`; Deploy run 43190699464
  green at 22:52 IST on 12 November, migrate included.)*

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract delivery-orders`. Run the
  reader query in production and on a fresh reset first: the order commands, the
  payment guard and the label trigger are the likely readers. Rewrite each to
  its on branch, then retire the row; update the pgTAP file that turns it.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
