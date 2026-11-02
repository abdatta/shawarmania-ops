# Design: Delivery Orders Are Made, Not Billed

## The owner's words, 2026-11-01

The design came out of one conversation. The decisions, in order:

1. The kitchen must see platform orders, through the counter, without them
   counting in the day's billing. Platform money stays with the sync.
2. **Call it Delivery, not Zomato.** It covers Zomato, Swiggy and anything later.
3. **Prices are not comparable.** A platform's price for a dish is usually higher
   than the counter's, because of commission. So a delivery order shows no
   money at all.
4. **No platform picker.** The biller types the platform's order ID into the
   label, which already exists. A picker is acceptable only if it costs nearly
   nothing; it did not (a second setting per outlet), so it was dropped.
5. Handed-over delivery orders are **stored and listed** beside the shift's
   bills, and a mistaken handover can be **undone**.
6. **Keep the label.** The owner questioned why it is thrown away: the customer
   or platform gave it for that order, and nobody will treat it as customer
   data. Agreed, and generalised to every order rather than delivery orders
   only.
7. **Every figure page gets a Counter · Delivery switch, never a combined view.**
   Placement was left to the agent (D7).

Do not reopen these without a reason the conversation did not consider.

## D1. Where "delivery" lives: a side table, not a service value

An order is a delivery order exactly while a row for it exists in a new table:

```
delivery_orders
  order_id              uuid primary key → orders(id)
  outlet_id             uuid not null → outlets(id)
  marked_at             timestamptz not null
  handed_over_at        timestamptz
  handed_over_by        uuid → profiles(id)
  handed_over_shift_id  uuid → counter shifts
  handed_over_device_id uuid → devices
  handover_command_id   uuid           -- the handover's client UUID
  check: the four handover columns and the command id are null together or set together
```

`orders.service_type` stays **null** on a delivery order, and its table and
packaging stay empty. Delivery is a fourth answer to "how was it served", but
it is stored apart from the other three on purpose:

- **The off path sees a plain order.** Every published build reads
  `service_type` to draw the service chip, to decide packaging and to validate
  a revision. A new enum value there would reach code that has never seen it.
  A side-table row reaches none of it.
- **It can move while the order is open**, as a service does (decision: the
  chip changes like the service). The revision command inserts or deletes the
  row. Deleting from a new table breaks no rule.

**Delivery excludes dine-in, takeaway, a table and packaging.** The new
commands refuse a delivery order with any of them.

## D2. Handed over is an order status

`alter type public.order_status add value 'handed_over'` — additive, as
`check_in_source` and `attendance_decision_kind` were.

A handed-over order is **not open**, so everything that asks "is this order
still in play?" gets the right answer without being touched:

- the counter rail and the kitchen board read `status in ('open','paid')` —
  a handed-over order leaves both;
- business-day readiness blocks on `status = 'open'` — a handed-over order
  does not block sign-off;
- the label-clearing trigger fires on `cancelled`, or `paid` and prepared —
  not on `handed_over` (D5 handles labels anyway);
- the commands that lock an order and require `open` refuse a handed-over one
  with the not-open category, unchanged.

**Rejected: keep status `open` and record the handover only in the side
table.** Every off-path read would see a handed-over order as open: it would
come back onto the rail, count in Overview's open total, and **block the day's
sign-off**. One gate-off would resurrect a whole day's handovers.

**Rejected: hand over as `cancelled`, with a reason.** The kitchen board reads
the day's cancelled orders to ring cancellation alerts, so a kitchen on the
old read would ring *Cancelled* for every handover. Stats would count
handovers as cancellations, and every reader would have to tell the two apart
forever. It is the "bill it and cancel it" idea the owner turned down, wearing
a different status.

## D3. The order guard is replaced, once, with the owner's agreement

`billing_order_guard` refuses every transition it does not list: open may go
to open, paid or cancelled, and anything else raises `invalid order
transition`. So `handed_over` cannot be reached without replacing it. **This
is the only replaced function in the change, and it needs the owner's
agreement before the migration is pushed** (AGENTS.md: `-- release-lint:
allow function-change — <reason>`, with the agreement recorded here).

Why this is safe:

- **The new body is today's body, byte for byte, plus two branches**, both
  taken only when `app_change_gate('delivery-orders')` is on:
  - `old.status = 'open' and new.status = 'handed_over'`: only `status` may
    change, and a `delivery_orders` row must exist for the order;
  - `old.status = 'handed_over'`: only to `open`, only `status` changing (the
    take-back). Any other change raises `handed-over orders are immutable`.
- **Nothing a published build writes reaches either branch.** No published
  build can write `handed_over`, so every existing write follows the same
  lines it does today. Every existing pgTAP billing test runs against the new
  body unchanged.
- **The incident lesson (#74) was a replaced function a build *called*, whose
  shape changed.** The guard is a trigger function: no build calls it, its
  signature does not change, and its behaviour for every existing write is
  unchanged.

Task 0.4 stops for the owner's yes. **If the owner says no**, the fallback is
D2's rejected cancelled form — written up, not built, and returned to the
owner.

**The owner agreed, 2026-11-01**, after being told in plain words what
changes (today's body plus the two gated branches), why no write a published
build makes is affected, how it differs from #74, and the cancelled-order
fallback. Answer: "Yes, replace it".

**A second widened object, found at apply.** `billing_commands.command_type`
is a closed check list, and the two new commands record their own kinds,
`hand_over_delivery` and `take_back_delivery_handover`. The check is dropped
and re-added in one statement with today's list plus those two, under
`-- release-lint: allow drop, constraint — …`. It only widens: every kind a
published build writes stays allowed, and no build reads the list. **The owner
agreed, 2026-11-01** ("Yes, widen the list"), after hearing the fallback:
logging the two under `prepare_order_lines` and `void_order_payment`, which
would misname them.

The handover's attribution lives on `delivery_orders` (D1), not on `orders`,
so the guard needs no new columns and `orders_change_fields_paired` is
untouched.

## D4. The commands

All four go through `billing_begin_command` / `billing_finish_command`. Each
carries a client UUID, is idempotent, and is queued in the outbox like every
counter write.

| Command | Does |
|---|---|
| `create_billing_order_v3` | `create_billing_order_v2` plus an optional `delivery: true`. With it, it refuses a service, table, packaging line, discount or customer; it inserts the `delivery_orders` row in the same transaction. Without it, it behaves exactly as `_v2`. |
| `revise_billing_order_v3` | `_v2` plus `delivery`, which inserts or deletes the row while the order is open, under the same refusals. |
| `hand_over_delivery_order` | Locks the order; requires `open` and a `delivery_orders` row. Ticks every line with food still owed, as the counter's own tick does, recording the ticks against `handover_command_id`. Sets the handover columns and `status = 'handed_over'`. The owning tablet's live shift only, as payment is. |
| `take_back_delivery_handover` | Requires `handed_over`, the owning tablet, a non-blank reason, and a request within five minutes of `handed_over_at`. It writes a `delivery_handover_takebacks` row (order, outlet, the handover's time and actor, who took it back, when, why), removes the ticks that carry the handover's command id, clears the handover columns and sets `status = 'open'`. Earlier ticks, Readies and acknowledgements stay. |

Read the current create and revise path before writing the `_v3`s. They are
the `_v2`s that `contract_dish_ticks` kept, delivering through
`prepare_order_lines_v2`. The `_v3`s **call into** the `_v2` bodies' shared
helpers rather than copying them, wherever the helpers allow.

**Pay refuses a delivery order.** A new gated trigger,
`orders_delivery_is_not_paid` (BEFORE UPDATE on `orders`, `when (old.status =
'open' and new.status = 'paid')`), raises if a `delivery_orders` row exists. It
is gated: with the gate off, the off path may bill an open delivery order, as
the proposal states. A gated trigger on an existing table is what the lint
allows (`trigger-ungated` is satisfied by the gate check).

**The five-minute window** is measured as payment take-back measures it, from
the stored `handed_over_at`. That timestamp follows the same rule as `paid_at`
for a command that was queued offline. Read `unpay_billing_order` and mirror
it exactly.

**Day change.** It finishes paid orders. An open delivery order at the day
change is stranded like any open order, and the manager cancels it from the
existing stranded-order path. A handed-over one is already finished.

**Cancellation** of an open delivery order uses today's cancel commands
unchanged: open to cancelled, with a reason. The `delivery_orders` row stays,
so history knows it was a delivery order.

## D5. Labels are kept

Labels live in `order_labels`. `orders_label_leaves_the_rail` deletes the
label when an order is cancelled, or paid and prepared. That trigger function
was made unconditional by `contract_dish_ticks`, and replacing it would be a
second `function-change`. So it stays, and a new table keeps a copy first:

```
kept_order_labels
  order_id   uuid primary key → orders(id)
  outlet_id  uuid not null → outlets(id)
  label      text not null  (same shape check as order_labels)
  kept_at    timestamptz not null
```

A new trigger, `orders_label_is_kept`, is **BEFORE UPDATE** on `orders`, so it
runs before the AFTER delete. It fires when an order leaves the rail
(`cancelled`, `paid` with `prepared_at` set, or `handed_over`), is gated, and
upserts the order's current `order_labels` row into `kept_order_labels`. If
the order is taken back and leaves again, the upsert overwrites it, so the
label kept is always the last one.

The new reads show `coalesce(order_labels.label, kept_order_labels.label)`.

**The label is still never written** to `bills`, a receipt, an SMS, a public
bill link or an export, and **never** used as a customer name. The spec says
so in the same requirement that now keeps it.

Labels deleted before the gate turned on are gone. Nothing backfills them.

## D6. The reads

Each is a new function. The `_v2` it supersedes stays for published builds,
and the toggle point picks one.

| Read | Change |
|---|---|
| `kitchen_board_v3` | `_v2` plus a `delivery` boolean per order. No label, as today. |
| `counter_operations_snapshot_v3` | The rail: a `delivery` flag per open order. My shift: the shift's handed-over delivery orders (dishes, label, handed-over time, take-back deadline) beside its bills, and each bill's order label. The Cash/UPI totals are unchanged. |
| `overview_today_v3` | `openPaise` leaves out open delivery orders, whose counter-price totals are not owed money. |
| `billing_day_stats_v2(outlet, date, scope)` | `scope = 'counter'`: today's twelve figures with delivery orders left out of the order counts and times. `scope = 'delivery'`: placed, updated, cancelled, handed over, seen, ready and the two averages, for delivery orders only. No money figures. |
| `billing_history_delivery_orders(outlet, date)` | The day's handed-over and cancelled delivery orders, with dishes, label, who rang it, who handed it over or cancelled it, and any take-back. |
| Billing History's bills | Gain the order's label through a `_v2` of `billing_history_bills`. |
| `sales_analytics_v3`, `sales_analytics_series_v3` | Gain `scope`. `'counter'` is exactly `_v2`. `'delivery'` counts handed-over delivery orders by the order's `business_date` (Day, Week) or Kolkata `ordered_at` hour (Hour), and for Items totals `order_items.quantity` of item lines from handed-over delivery orders. There are no revenue figures in the delivery scope: the function returns null, and the screen shows the measure as unavailable. |

The Items page's dish rows read through the same family. If Items has its own
function, give it a `_v2` with `scope` on the same terms.

**Money arithmetic: none.** A delivery order still has integer-paise totals,
because the line validation snapshots the counter's prices. **No read in this
change sums them, and no screen shows them.** This is written into the spec, so
a later read cannot start summing them.

## D7. The screens

- **Composer.** The service row gains a **Delivery** chip, shown when the
  outlet offers it, alone if it offers neither Dine-in nor Takeaway. With
  Delivery chosen, the composer hides the customer control, the discount
  control and the total, and its only action is **Order**. The label field
  stays at the top, as today.
- **Rail card.** **Delivery** sits in the service slot. The card shows the
  label as its headline, as today, and no total. Its footer action is **Hand
  over**, where Mark Paid would be; there is no payment line. Dish ticks work
  as on any card.
- **Kitchen card.** **Delivery** in the service slot. Nothing else differs.
- **My shift.** Handed-over delivery orders sit in time order among the bills.
  Each is a row marked **Delivery**, with label, time and dishes, and no
  amount. **Take back** shows only inside the window, and opens the same
  reasoned confirmation as taking back a payment, minus the amount.
- **The outlet's Orders section.** A **Delivery** switch beside Dine-in and
  Takeaway, owned by the same people (owner and the outlet's managers).
  `set_outlet_service_settings_v2` carries it.
- **Counter · Delivery switch.** A two-option segmented control in each page's
  control row, after the date controls: Stats (above its groups), Billing
  History (above its list; Delivery lists delivery orders, Counter lists bills
  as today), Analytics → Items and Analytics → Sales (beside Measure). Counter
  is the default. Each page remembers its choice in browser storage, as it
  remembers its date shortcut, wrapped in try/catch. In Delivery, Sales'
  Revenue and AOV options and Items' Dish revenue are disabled with an
  accessible reason ("Delivery orders carry no money"). The **delivery
  revenue section** #73 added to Sales stays where it is, outside the switch:
  it is the platforms' money, not these orders.
- **Shimmer.** Each surface whose layout moves (the rail card, My shift, the
  Stats groups) has its placeholder reshaped in the same change (AGENTS.md).
- Owner UI conventions apply: verb-only buttons, no sentence under a heading,
  tiles not sentences.

**The owner approves these in the demo before anything is wired live** (tasks
§6), on a tablet for the counter and kitchen and on a phone for the rest, in
both themes.

## D8. RLS and authority

- `delivery_orders`, `delivery_handover_takebacks`, `kept_order_labels`:
  **select** as `order_labels_select` does — a live counter shift at its own
  outlet, the outlet's Franchise Admins and the owner, behind
  `app_device_ok()`. **No kitchen select**: the kitchen learns *Delivery*
  through `kitchen_board_v3`, which is security definer and returns only the
  flag. No insert, update or delete grants. Writes happen only inside the
  commands and the trigger.
- Every new read refuses another outlet's manager and anonymous callers, as
  its `_v2` does.
- **Isolation tests** for all three tables, and a hand-crafted-request test for
  every new command and read.
- `outlets.delivery_offered` is written only through
  `set_outlet_service_settings_v2`, by the same people as the other choices.

## D9. Offline and queued work

The four commands are outbox commands, like create, revise, pay and take-back.
They commit locally before the UI moves on, and replay exactly once by client
UUID. **The outbox never reads a gate**, and **the server accepts every one
of them whatever the gate says**. So a handover queued with the gate on lands
after it is turned off. Only the UI and the gated triggers read the gate.

Round trip: `tested`. A `@cg-round-trip:delivery-orders` browser test queues a
delivery create and a handover offline with the gate on, turns the gate off,
reconnects, and shows both land, the order handed over and gone from the rail.

A take-back queued offline past the five minutes is refused as late on
arrival and shows as needs-attention, as a late payment take-back does.

## Version skew

| Object | A published build | Gate off |
|---|---|---|
| `order_status 'handed_over'` | Never writes it; reads filtered by explicit statuses never see it. Generated types widen; the off path's code is unchanged. | Handed-over orders invisible. |
| `billing_order_guard` (replaced, D3) | Every write it makes takes the same branch as today. | New branches closed. |
| `delivery_orders`, `delivery_handover_takebacks`, `kept_order_labels` | Never reads them. | Rows stay, unread. |
| `outlets.delivery_offered` (default false) | Never reads it; `set_outlet_service_settings` leaves it alone. | Ignored. |
| `orders_delivery_is_not_paid`, `orders_label_is_kept` | Fire on its writes, return at once while off. | Inert. |
| `_v2`/`_v3` reads and commands | Keeps calling its own versions. | The toggle point calls the old ones. |

**What turning the gate off does to persisted data** is in the proposal's
Change gate section. An open delivery order becomes an ordinary-looking open
order; a handed-over one disappears from every surface; kept labels sit
unread. The gate's page should say *turn this off with no delivery order on
the rail*. That is release guidance in `/release`, not code.

## Demo

The demo outlet that already offers Dine-in and Takeaway also offers Delivery.
Its fixtures carry a cooking delivery order on the rail and the kitchen, two
handed-over ones in My shift (one inside the take-back window), one cancelled,
and a few days of delivery orders so Stats, Items and Sales have a Delivery
view to show. The mocks are typed from the generated schema, so every new
column and status is real before a screen uses it.

## Request budget

`kitchen_board_v3` and `counter_operations_snapshot_v3` replace their `_v2`s
one for one. An idle counter and kitchen make the same requests, and so do a
hand-over and an ACK. `e2e-auth/request-budget.spec.ts` should pass unchanged.
If it does not, find out why before raising it.

## Interaction with other open changes

- **#80 `waiters-take-orders-on-their-phones`** (proposed): a waiter's order
  may want Delivery. Whichever lands second decides. This change does not
  offer Delivery to a waiter.
- **#82 and the gate limit:** at most five independent change gates. Recount
  at task 0.2; if `delivery-orders` would be the sixth, the owner retires one
  first, or this waits.

## Rejected alternatives

- **Ring it as a bill with a Zomato tender and hide it from the money pages.**
  Every money read would need a filter, and the first one missed counts it
  twice. Zomato and Swiggy are refused as tenders for exactly this reason.
- **Bill it, then cancel it.** It pollutes cancellations and hides the real
  ones.
- **A Zomato-only flag.** The owner generalised it (decision 2).
- **A Zomato/Swiggy picker.** The label carries it (decision 4).
- **Pull orders from the platforms.** There is no live feed; the sync runs
  twice a day through a sign-in.
- **A separate delivery-orders table with its own lines.** Ticks, Readies,
  acknowledgements and order numbers all hang off `orders`; a parallel table
  would duplicate the kitchen's machinery.
- **`service_type 'delivery'`** (D1). **Status stays `open`** and **handover as
  `cancelled`** (D2).
- **Keeping labels only on delivery orders.** Two rules where one will do
  (decision 6).
- **Replacing `order_label_leaves_the_rail`** to stop deleting. That would be a
  second replaced function; a BEFORE trigger that copies first needs none.
- **A combined counter-and-delivery view** (decision 7).
- **Showing the label to the kitchen.** The kitchen goes by the order number,
  and #74 kept customer facts off the kitchen board.

## Release

`/release delivery-orders` at a quiet hour, with Kalyani Cafe's Delivery
setting still off. Then the owner or the Cafe's manager turns Delivery on for
the Cafe. Watch the first service's delivery orders: the kitchen rings for
them, they are handed over and appear in My shift, and Stats → Delivery counts
them. **Pull it once** (off and on) with no delivery order on the rail.
