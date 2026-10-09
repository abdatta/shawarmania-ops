# Design: The Day Change Finishes Paid Orders

## Context

An order answers two independent questions — is the food made (`orders.prepared_at`)
and is it paid (`orders.status`) — and leaves the counter's rail only when both are
answered (#45, #55). Only the tablet that took an order may answer either
(`prepare_billing_order` checks `v_order.device_id = auth.uid()`), and the rail read
asks for `status = 'open' or (status = 'paid' and prepared_at is null)` with **no
business-date filter**. So a paid order whose Prepared tick was forgotten stays on
every till's rail until its own till opens another shift and somebody ticks it.

Production, read 2026-10-08: of 2,751 orders, none is on a rail from an earlier
business date today. Order 35 (Kalyani, Tablet 1) is the one recorded case of a
forgotten tick that needed a repair: paid 17 Sep 22:05, its shift ended 18 Sep 01:46,
the tablet held no shift on the 18th while Tablet 2 traded, and
`backfill_prepared_history()` was run from a laptop on the 19th, hours before Tablet 1
opened again at 16:19 — at which point the tick could have been made on screen.

This change exists now because `the-kitchen-sees-its-orders` makes the rail visible
in the kitchen, where a forgotten tick reads as food still to cook.

## The owner's rule, stated exactly

**A paid order is eventually served.** The owner's words: the biller *"would very very
likely have marked it paid"*, and *"even if they would have served it later, they
would have served it."* The *eventually* is load-bearing and was nearly lost in
discussion: it is **not** a claim that a paid order has been served at the moment
the day is closed — the food may still be cooking when someone presses Finish Day.
It is a claim that it has been served by the time the shop has shut.

The business-day cutover is chosen to sit after the latest close and before the
earliest open (`docs/BUSINESS_CONTEXT.md`), so it is the earliest instant at which
the claim is reliably true. Every decision below follows from acting at that instant
and no earlier.

## Decisions

### D1. The sweep stamps the cutover, not the time it ran

A paid, unprepared order is finished by setting

```
prepared_at     = the instant the business day of its payment ends
                = (bills.payment_business_date + 1) at outlets.business_day_cutover, Asia/Kolkata
prepared_source = 'day_change'
```

for every order where `status = 'paid' and prepared_at is null` and that instant has
passed.

- **Payment's business date, not the order's.** An order taken at 03:55 and paid at
  04:05 belongs to day D for revenue and D+1 for the drawer. Stamping it at the end of
  D would record it as prepared before it was paid. The end of the payment's day is
  never earlier than the payment.
- **The stored date, never a date derived from a timestamp.** `payment_business_date`
  is written at payment under the outlet's cutover; the sweep reads it. The only
  derivation is the cutover instant from a stored date, which is the direction the
  repo allows.
- **The outlet's cutover as it stands when the sweep runs.** If the owner moves the
  cutover, an order not yet swept is stamped at the new one. Acceptable: the stamp is
  a bound on when the food went out, and either cutover is a closed shop.

Because the value is determined by stored facts, **a sweep that runs late, or misses
a night, produces byte-identical rows when it does run.** Lateness costs only how long
the order lingers on the rail — which is exactly today's behaviour. This keeps the
repo's standing preference that nothing load-bearing depends on a job having run
(`counter_shifts.expires_at` is stored so that "is this shift live?" needs no job).

### D2. A scheduled function, every minute — then every ten

`public.finish_paid_orders_at_day_change(p_now timestamptz default now())` is
`security definer`, performs the update in D1 for every outlet, returns the count it
finished, and is scheduled with `pg_cron` every minute, beside `bill-receipt-recovery`
(`20261004000000_bill_receipt_delivery.sql`), which established the extension.
`p_now` exists so pgTAP can drive it across a cutover without waiting for one.

Every minute rather than once at 04:00 because outlets may carry different cutovers,
because a once-a-day job that misses its minute waits a day, and because the
predicate rides `orders_pipeline_idx` (`status = 'open' or (status = 'paid' and
prepared_at is null)`), so an idle sweep reads a handful of index entries.

Execute is revoked from `public`, `anon`, `authenticated` and `service_role`; only the
owner role that `pg_cron` runs as may call it. The write passes `billing_order_guard`
the same way a counter command does — by setting the transaction-local
`app.billing_command` flag the guard already honours — and the guard's whitelist of
columns a paid order may change gains `prepared_source` beside `prepared_at`.

The sweep writes **no `billing_commands` receipt**: it is not a counter command, has
no tablet, shift or envelope, and a receipt would be a fabricated one. Consequently it
does not invalidate a tablet's end-of-day confirmation, which staleness is defined by
accepted commands; that is correct, since nothing a tablet sent has changed.

**Revised after a trading day in production (owner, 2026-10-09).** The job cost
nothing metered — no request, egress or Realtime message, 17 ms a run — but
`pg_cron` keeps a `cron.job_run_details` row for every run of every job forever,
about 0.25 MB a day per every-minute job, against the Free Plan's 0.5 GB. So
`20261011000000_scheduled_jobs_stay_small.sql` reschedules the day change to every
ten minutes — the stamp is the cutover whatever minute the sweep runs, so only how
long an unticked order lingers changes, to at most ten minutes past 04:00 — and adds
`cron-run-history-keeps-a-week`, which deletes run history older than seven days
for every job daily at 05:00 IST. Production's `postgres` role, which owns the jobs,
is not a superuser but holds DELETE on `cron.job_run_details` (checked 2026-10-09).

### D3. The order records who finished it

`orders.prepared_source text` — `'counter'` or `'day_change'` — paired with
`prepared_at` by check constraint: both null or both set. Existing rows with a
`prepared_at` are backfilled `'counter'`, including order 35 and anything else the
laptop repair stamped, because nothing distinguishes them (non-goal: no retroactive
tracking). `bill_items`, `bills` and every money column are untouched.

The measurement the owner asked for is then one query, written into
`docs/OPERATIONS.md`:

```sql
select o.name, b.payment_business_date, count(*)
  from orders x
  join bills b on b.id = x.bill_id
  join outlets o on o.id = x.outlet_id
 where x.prepared_source = 'day_change'
 group by 1, 2 order by 2 desc;
```

A boolean was considered and rejected: a source column says what happened in both
cases rather than only in the unusual one, and a third source (a kitchen marking
food ready, should the kitchen ever get that action) would otherwise need a second
boolean.

### D4. Finish Day stops refusing; it says what will happen instead

`confirm_billing_end_of_day` loses its `unresolved_preparation` refusal. The readiness
sheet keeps counting the orders (`foodOwedCount` stays in `CounterDayReadiness`) and
draws them as an **advisory** in the shape the open-edit-window advisory already
takes:

> *1 order is paid but not marked prepared — it will be marked prepared at 04:00.*

with the outlet's own cutover formatted in place of 04:00. Finishing the day does
**not** mark these orders prepared. They stay on the rail — and on the kitchen screen,
once it exists — until a tick or the cutover, whichever comes first.

Why this is safe for money: the requirement *Nothing moves after the day is closed*
(`counter-billing`) already has the database refuse a take-back, a cancel-after-paid
and a tender correction for a bill whose day was finished, proved by hand-crafted
request in #55. That refusal is **the ended shift and nothing else**
(`billing_device_context`), which implementation made explicit: before this change
no order could be paid and unprepared behind a closed day, so it never mattered
that a *new* shift on the same tablet could still reach a payment whose window had
not started. Now it can. A biller who opens another shift that night may take back
the payment on an order whose food never came — a legitimate refund — and the
accepted command makes that tablet's end-of-day confirmation stale, exactly as any
command after a close always has, so the manager sees the day is no longer final.
`54_the_ticket_is_two_switches.sql` proves both halves. No new lock was added: the
staleness rule is the repo's existing answer to "money moved after the day was
closed", and the first half of the refusal's justification — a paying customer
still owed food — is exactly the case where marking it prepared would be wrong and
keeping it visible is right.

Unpaid open orders still refuse, unchanged: money is still to be collected.

The server-side status `unresolved_preparation` stops being produced. An older cached
client that still knows it handles its absence correctly, since it only ever reacted
to its presence.

### D5. A late counter tick supersedes the stamp

A tablet offline overnight may hold a Prepared tick made at 23:40 and deliver it after
the sweep. Today `prepare_billing_order` refuses `prepared = true` on a paid order that
already has `prepared_at` as `order_not_open`, which would leave the tablet a
needs-attention item for something the biller did correctly.

So: when the order's `prepared_source = 'day_change'`, a prepare command is
**accepted**. If its command time is earlier than the stamp, `prepared_at` takes the
command time and `prepared_source` becomes `'counter'`; otherwise it is accepted with
no change. The counter's record is the truer one — the tick was made, it was only
late — and the measurement should not count an order the biller did tick.

The existing refusal stands for `prepared_source = 'counter'`: a second tick on a
paid, already-ticked order is still `order_not_open`.

### D6. An unwind clears the stamp

`unpay_billing_order` delivered after the sweep, with a command time inside the
window, reopens the order. The day change's stamp was premised on the payment, and the
payment is gone, so the unwind sets `prepared_at` and `prepared_source` back to null
when the source was `'day_change'`. A counter-sourced preparation survives an unwind
exactly as it does today (a reopened prepared order is open and prepared).
`cancel_paid_billing_order` leaves the stamp alone: a cancelled order is off every
rail and its preparation is history.

This path is narrow — the command must have been created before the cutover, under
the shift that was live then, and delivered late — but it exists, and an open order
carrying a day-change stamp would read as prepared food nobody prepared.

### D7. The laptop repair is retired

`backfill_prepared_history()` is dropped in the same migration. Its only job was this
one, done by hand, and done with a worse timestamp (`paid_at`). The sweep's first run
finishes every historical paid-but-unprepared order at its own day's cutover. The
`docs/OPERATIONS.md` section describing the repair, including order 35's account,
is replaced by the measurement query and a check for whether the cron job is running
(`select * from cron.job_run_details where jobid = ... order by start_time desc`).

### D8. Demo mode

The mock billing adapter has no scheduler. It applies D1 as a projection at read
time over the demo clock: a paid, unprepared mock order whose payment business date
has ended is returned with `preparedAt` at that cutover. The demo holds an upfront
payment beside its order until preparation and writes the bill only then, so the
payment's business date comes from the bill where there is one and from the held
payment otherwise. The demo never writes.

**No client reads `prepared_source`.** Nothing on any screen differs between a
tick and the day change — the order is prepared either way — so the source is not
added to `BillingOrder`; it is a database fact for the counting query. A future
surface that needs it adds it then.

## Money, RLS and offline, called out

- **Money arithmetic:** none. No total, tender, discount, points figure or drawer
  amount is read or written. The edit-window function is unchanged; it receives a
  preparation time from a new source.
- **RLS:** no new table and no policy change. `prepared_source` is a column on
  `orders`, readable wherever an order is, writable only through the guard's command
  path and the sweep. A hand-crafted `update orders set prepared_source = ...` from an
  authenticated session, an FA session and a tablet session is each refused; a
  hand-crafted `rpc('finish_paid_orders_at_day_change')` is refused for every client
  role.
- **Offline:** the counter's projection must render a day-change stamp it learns on
  refresh exactly as a tick (D5 covers commands in flight). The tablet's local overlay
  may still believe an order unprepared until its next read; that is today's
  staleness, not a new one. No envelope type, schema version or canonical hash
  changes: D5 and D6 are server-side acceptance rules, not payload changes.

## Rejected alternatives

- **Finish the order when its tablet's shift ends** (Finish Day, Leave counter,
  cutover expiry, tablet removed). Proposed first in discussion and withdrawn: a shift
  can end while food is still cooking — Finish Day pressed early, a mid-afternoon
  Leave counter — and the order would vanish from the kitchen before it was served.
  It also needs a trigger at every way a shift ends, one of which (expiry) is not an
  event.
- **Finish Day marks paid orders prepared.** Same fault at the moment it matters
  most: the owner pointed out that pressing Finish Day with food on the grill would
  clear it from the kitchen screen.
- **Finish Day keeps refusing.** The owner asked why, and the answer did not survive
  inspection (D4): the money half is already enforced by the database after a day is
  finished, the day is rarely finished anyway, and the remaining half argues for
  keeping the order visible, not for blocking.
- **Ignore Leave counter as a trigger, keep the others.** Superseded by tying the rule
  to the cutover alone, which makes no shift ending a trigger.
- **Derive "finished" at read time instead of storing it.** The rail read and the
  kitchen read would each need the predicate, the edit-window function would need it,
  and the owner wants the cases counted — a derived state leaves nothing to count.
- **Stamp the time the sweep ran.** Makes the record depend on the job's punctuality
  and a missed night visible in the data forever.
- **Stamp the end of the order's business date.** Can precede the payment (D1).
- **Mark late-arriving paid orders prepared on arrival.** Considered for an offline
  tablet that delivers yesterday's paid orders this morning, which would sit on the
  rail for up to a minute before the sweep. The owner judged it rare and declined it
  (2026-10-08); the sweep's minute is the accepted exposure.
- **Also finish unpaid open orders at the cutover.** Unpaid is money to chase; the
  owner scoped the rule to paid orders explicitly. Two of 2,751 orders have ever
  crossed a cutover unpaid; both were resolved by hand the next day.
- **A boolean `prepared_by_day_change`.** See D3.
- **Keep `backfill_prepared_history()` for emergencies.** It does a strictly worse
  version of the sweep's job by hand; keeping it keeps a runbook path to a timestamp
  nobody should write.

## Risks

- **The cron job silently stops.** Effect: today's behaviour returns — orders linger.
  No wrong data is written. `docs/OPERATIONS.md` names the check.
- **A cutover change between payment and sweep** stamps the new cutover. Bounded and
  harmless (D1).
- **A paid order genuinely never served** — the customer left, nobody refunded — is
  recorded as prepared at the cutover. That was already the outcome of the laptop
  repair, and it is now counted and attributable to the day change.
